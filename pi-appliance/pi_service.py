#!/usr/bin/python3
"""Local-only Pi appliance bridge. Never exposes a TCP port or executes shell input."""
import grp
import ipaddress
import json
import os
import pwd
import re
import secrets
import socket
import socketserver
import struct
import subprocess
import threading
import time
import uuid

NM = 'org.freedesktop.NetworkManager'
ROOT = '/org/freedesktop/NetworkManager'
TIMEOUT = 120


def text(value, name, maximum=128):
    if not isinstance(value, str) or not value or len(value.encode()) > maximum or '\x00' in value:
        raise ValueError('Invalid ' + name)
    return value


def ipv4_config(req):
    method = req.get('method')
    if method not in ('auto', 'manual'):
        raise ValueError('Choose DHCP or static IPv4')
    controller = req.get('controllerOnly', False)
    if not isinstance(controller, bool):
        raise ValueError('Invalid controller network option')
    result = {'method': method, 'never-default': controller, 'ignore-auto-dns': controller}
    if method == 'manual':
        addr = ipaddress.IPv4Interface(text(req.get('address'), 'IPv4 address'))
        if addr.ip.is_multicast or addr.ip.is_unspecified or addr.ip.is_loopback:
            raise ValueError('Invalid host address')
        result['address-data'] = [{'address': str(addr.ip), 'prefix': addr.network.prefixlen}]
    gateway = req.get('gateway', '')
    if gateway:
        if controller:
            raise ValueError('A controller-only network must not have a gateway')
        result['gateway'] = str(ipaddress.IPv4Address(gateway))
    dns = req.get('dns', [])
    if not isinstance(dns, list) or len(dns) > 4:
        raise ValueError('Enter up to four IPv4 DNS servers')
    if dns:
        result['dns-data'] = [str(ipaddress.IPv4Address(d)) for d in dns]
    return result


class NetworkManager:
    def __init__(self):
        import dbus
        self.d = dbus
        # Hotspot monitoring and the Unix request handler run on separate threads.
        self.bus = dbus.SystemBus(private=True)
        self.manager = self.interface(ROOT, NM)

    def interface(self, path, kind):
        return self.d.Interface(self.bus.get_object(NM, path), kind)

    def props(self, path, kind):
        return self.interface(path, 'org.freedesktop.DBus.Properties').GetAll(kind)

    def device(self, name, expected=None):
        text(name, 'interface', 32)
        path = self.manager.GetDeviceByIpIface(name)
        props = self.props(path, NM + '.Device')
        dtype = int(props['DeviceType'])
        if dtype not in (1, 2) or (expected is not None and dtype != expected):
            raise ValueError('Unsupported network interface')
        return path, props

    def status(self):
        devices = []
        for path in self.manager.GetDevices():
            p = self.props(path, NM + '.Device')
            if int(p['DeviceType']) not in (1, 2):
                continue
            entry = {'name': str(p['Interface']), 'type': 'wifi' if int(p['DeviceType']) == 2 else 'ethernet',
                     'state': int(p['State']), 'addresses': [], 'gateway': '', 'dns': []}
            if int(p['DeviceType']) == 2:
                entry['apSupported'] = bool(int(self.props(path, NM + '.Device.Wireless')['WirelessCapabilities']) & 0x40)
            if int(p['DeviceType']) == 2 and str(p['ActiveConnection']) != '/':
                active = self.props(p['ActiveConnection'], NM + '.Connection.Active')
                profile = self.interface(active['Connection'], NM + '.Settings.Connection').GetSettings()
                wifi = profile.get('802-11-wireless', {})
                entry['wifiMode'] = str(wifi.get('mode', 'infrastructure'))
                entry['ssid'] = bytes(wifi.get('ssid', [])).decode('utf-8', errors='replace')
            if str(p['Ip4Config']) != '/':
                ip = self.props(p['Ip4Config'], NM + '.IP4Config')
                entry['addresses'] = [str(a['address']) + '/' + str(a['prefix']) for a in ip['AddressData']]
                entry['gateway'] = str(ip['Gateway'])
                entry['dns'] = [str(n['address']) for n in ip.get('NameserverData', [])]
            devices.append(entry)
        return devices

    def scan(self, name):
        path, _ = self.device(name, 2)
        wifi = self.interface(path, NM + '.Device.Wireless')
        try:
            wifi.RequestScan(self.d.Dictionary({}, signature='sv'))
        except self.d.DBusException:
            pass  # NM throttles scans; return cached results and allow refresh.
        networks = []
        for ap in wifi.GetAllAccessPoints():
            p = self.props(ap, NM + '.AccessPoint')
            ssid = bytes(p['Ssid']).decode('utf-8', errors='replace')
            if not ssid:
                continue
            flags = int(p['WpaFlags']) | int(p['RsnFlags'])
            security = 'personal' if flags & 0x100 else ('open' if not flags and not int(p['Flags']) & 1 else 'unsupported')
            networks.append({'ssid': ssid, 'signal': int(p['Strength']), 'security': security})
        unique = {}
        for n in sorted(networks, key=lambda n: n['signal'], reverse=True):
            unique.setdefault((n['ssid'], n['security']), n)
        return list(unique.values())

    def checkpoint(self, name):
        path, _ = self.device(name)
        return self.manager.CheckpointCreate(self.d.Array([path], signature='o'), self.d.UInt32(TIMEOUT), self.d.UInt32(2))

    def rollback(self, checkpoint):
        results = self.manager.CheckpointRollback(checkpoint)
        if any(int(code) != 0 for code in results.values()):
            raise RuntimeError('Network rollback needs manual recovery')
        if checkpoint in self.props(ROOT, NM).get('Checkpoints', []):
            self.manager.CheckpointDestroy(checkpoint)

    def confirm(self, checkpoint):
        self.manager.CheckpointDestroy(checkpoint)

    @staticmethod
    def validate_wifi(req):
        text(req.get('ssid'), 'SSID', 32)
        if not isinstance(req.get('hidden', False), bool):
            raise ValueError('Invalid hidden network option')
        security = req.get('security')
        if security not in ('open', 'personal'):
            raise ValueError('Only open and WPA/WPA2 personal Wi-Fi are supported in this build')
        if security == 'personal':
            password = text(req.get('password'), 'Wi-Fi password', 64)
            if not (8 <= len(password) <= 63 or re.fullmatch('[0-9a-fA-F]{64}', password)):
                raise ValueError('WPA password must be 8–63 characters or 64 hexadecimal digits')

    def stop_hotspot(self, name, ssid):
        path, props = self.device(name, 2)
        active = props['ActiveConnection']
        if str(active) == '/':
            return
        profile_path = self.props(active, NM + '.Connection.Active')['Connection']
        wifi = self.interface(profile_path, NM + '.Settings.Connection').GetSettings().get('802-11-wireless', {})
        if str(wifi.get('mode')) == 'ap' and bytes(wifi.get('ssid', [])).decode('utf-8') == ssid:
            self.manager.DeactivateConnection(active)

    def activate_hotspot(self, name, config):
        from pi_hotspot import ADDRESS
        path, _ = self.device(name, 2)
        caps = int(self.props(path, NM + '.Device.Wireless')['WirelessCapabilities'])
        if not caps & 0x40:
            raise ValueError('This Wi-Fi adapter does not support access point mode')
        for device in self.status():
            if device['name'] != name and any(ipaddress.IPv4Interface(a).network.overlaps(ipaddress.IPv4Network(ADDRESS + '/24', strict=False)) for a in device['addresses']):
                raise ValueError('The setup hotspot subnet overlaps another network')
        d = self.d
        profile_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, config['ssid'] + '.' + name))
        settings = {
            'connection': {'id': 'EZPlayer-Setup-' + name, 'uuid': profile_uuid,
                           'type': '802-11-wireless', 'interface-name': name, 'autoconnect': d.Boolean(False)},
            '802-11-wireless': {'ssid': d.ByteArray(config['ssid'].encode()), 'mode': 'ap', 'band': 'bg'},
            '802-11-wireless-security': {'key-mgmt': 'wpa-psk', 'psk': config['password'],
                                       'proto': d.Array(['rsn'], signature='s')},
            'ipv4': {'method': 'shared', 'never-default': d.Boolean(True),
                     'address-data': d.Array([d.Dictionary({'address': ADDRESS, 'prefix': d.UInt32(24)}, signature='sv')], signature='a{sv}')},
            'ipv6': {'method': 'disabled'},
        }
        connection = d.Dictionary({k: d.Dictionary(v, signature='sv') for k, v in settings.items()}, signature='sa{sv}')
        manager = self.interface(ROOT + '/Settings', NM + '.Settings')
        try:
            profile = manager.GetConnectionByUuid(profile_uuid)
        except d.DBusException:
            _, active = self.manager.AddAndActivateConnection(connection, path, d.ObjectPath('/'))
        else:
            self.interface(profile, NM + '.Settings.Connection').Update(connection)
            active = self.manager.ActivateConnection(profile, path, d.ObjectPath('/'))
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            current = self.props(path, NM + '.Device')
            if int(current['State']) == 100 and current['ActiveConnection'] == active:
                return
            if int(current['State']) == 120:
                raise RuntimeError('Hotspot activation failed')
            time.sleep(0.5)
        raise RuntimeError('Hotspot activation timed out')

    def activate(self, req, wifi=False):
        name = req['interface']
        path, _ = self.device(name, 2 if wifi else 1)
        d = self.d
        ipv4 = ipv4_config({'method': 'auto'} if wifi else req)
        ipv4['never-default'] = d.Boolean(ipv4['never-default'])
        ipv4['ignore-auto-dns'] = d.Boolean(ipv4['ignore-auto-dns'])
        if 'address-data' in ipv4:
            ipv4['address-data'] = d.Array([d.Dictionary({'address': a['address'], 'prefix': d.UInt32(a['prefix'])}, signature='sv') for a in ipv4['address-data']], signature='a{sv}')
        if 'dns-data' in ipv4:
            ipv4['dns-data'] = d.Array(ipv4['dns-data'], signature='s')
        controller = bool(req.get('controllerOnly', False)) if not wifi else False
        settings = {
            'connection': {'id': 'EZPlayer-' + name + '-' + uuid.uuid4().hex[:8], 'uuid': str(uuid.uuid4()),
                           'type': '802-11-wireless' if wifi else '802-3-ethernet', 'interface-name': name,
                           'autoconnect': d.Boolean(True), 'autoconnect-priority': d.Int32(100)},
            'ipv4': ipv4,
            'ipv6': {'method': 'disabled' if controller else 'auto', 'never-default': d.Boolean(controller)},
        }
        if wifi:
            self.validate_wifi(req)
            ssid = text(req.get('ssid'), 'SSID', 32)
            security = req.get('security')
            settings['802-11-wireless'] = {'ssid': d.ByteArray(ssid.encode()), 'mode': 'infrastructure',
                                         'hidden': d.Boolean(req.get('hidden', False))}
            if security == 'personal':
                password = text(req.get('password'), 'Wi-Fi password', 64)
                settings['802-11-wireless-security'] = {'key-mgmt': 'wpa-psk', 'psk': password}
        else:
            settings['802-3-ethernet'] = d.Dictionary({}, signature='sv')
        connection = d.Dictionary({k: d.Dictionary(v, signature='sv') for k, v in settings.items()}, signature='sa{sv}')
        _, active = self.manager.AddAndActivateConnection(connection, path, d.ObjectPath('/'))
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            current = self.props(path, NM + '.Device')
            state = int(current['State'])
            if state == 100 and current['ActiveConnection'] == active:
                return
            if state == 120:
                raise RuntimeError('Network activation failed')
            time.sleep(0.5)
        raise RuntimeError('Network activation timed out')


class Appliance:
    def __init__(self, network, hotspot=None):
        self.network = network
        self.hotspot = hotspot
        self.pending = None
        self.lock = threading.Lock()

    def request(self, req, uid):
        if not isinstance(req, dict):
            raise ValueError('Invalid request')
        action = req.get('action')
        with self.lock:
            if action == 'registerWeb':
                expected_uid = int(open('/etc/ezplayer-pi-player-uid').read().strip())
                port = req.get('port')
                if uid != expected_uid or type(port) is not int or not 1024 <= port <= 65535:
                    raise ValueError('Invalid player web registration')
                from pi_hotspot import save_config
                save_config('/run/ezplayer-pi/web-port.json', {'port': port})
                os.chown('/run/ezplayer-pi/web-port.json', 0, grp.getgrnam('ezplayer-system').gr_gid)
                os.chmod('/run/ezplayer-pi/web-port.json', 0o640)
                return {'ok': True}
            if self.pending and time.monotonic() >= self.pending['expires']:
                self.pending = None  # NetworkManager's timer owns automatic rollback.
            if action == 'status':
                pending = None
                if self.pending and self.pending['uid'] == uid:
                    pending = {'token': self.pending['token'], 'seconds': max(0, int(self.pending['expires'] - time.monotonic()))}
                stat = os.statvfs('/home')
                return {'devices': self.network.status(), 'pending': pending, 'hostname': socket.gethostname(),
                        'hotspot': self.hotspot.status() if self.hotspot else None,
                        'freeBytes': stat.f_bavail * stat.f_frsize, 'timezone': open('/etc/timezone').read().strip() if os.path.isfile('/etc/timezone') else os.path.realpath('/etc/localtime').split('/zoneinfo/')[-1]}
            if action == 'scan':
                return self.network.scan(req.get('interface'))
            if action == 'hotspot':
                if not self.hotspot:
                    raise ValueError('Tethering is unavailable')
                if self.pending:
                    raise ValueError('Confirm or revert the pending network change first')
                return self.hotspot.set_mode(req.get('mode'), req.get('ssid'), req.get('password'))
            if action in ('wifi', 'ethernet'):
                if self.pending:
                    raise ValueError('Confirm or revert the pending network change first')
                self.network.device(req.get('interface'), 2 if action == 'wifi' else 1)
                if self.hotspot and self.hotspot.busy:
                    raise ValueError('Wait for the Wi-Fi connection attempt to finish')
                if action == 'wifi' and self.hotspot and self.hotspot.status()['active']:
                    return self.hotspot.queue_wifi(req)
                if action == 'ethernet':
                    ipv4_config(req)
                checkpoint = self.network.checkpoint(req['interface'])
                expires = time.monotonic() + TIMEOUT
                try:
                    self.network.activate(req, wifi=action == 'wifi')
                except Exception:
                    self.network.rollback(checkpoint)
                    raise ValueError('Connection failed; previous settings restored. Check the password, cable, and IP settings.') from None
                token = secrets.token_hex(24)
                self.pending = {'checkpoint': checkpoint, 'token': token, 'uid': uid,
                                'expires': expires}
                return {'token': token}
            if action in ('confirm', 'revert'):
                if not self.pending or self.pending['uid'] != uid or not secrets.compare_digest(str(req.get('token', '')), self.pending['token']):
                    raise ValueError('No matching pending change; it may have already reverted')
                if action == 'confirm':
                    self.network.confirm(self.pending['checkpoint'])
                else:
                    self.network.rollback(self.pending['checkpoint'])
                self.pending = None
                return {'ok': True}
            if action == 'timezone':
                zone = text(req.get('timezone'), 'time zone')
                if not re.fullmatch('[A-Za-z0-9_+/-]+', zone) or '..' in zone or not os.path.isfile('/usr/share/zoneinfo/' + zone):
                    raise ValueError('Invalid IANA time zone')
                subprocess.run(['/usr/bin/timedatectl', 'set-timezone', zone], check=True, timeout=10, capture_output=True)
                return {'ok': True}
            if action in ('reboot', 'shutdown', 'restartPlayer'):
                if self.pending:
                    raise ValueError('Confirm or revert the network change before powering off')
                # Delay gives the IPC/UI time to receive success. No arbitrary command arguments.
                if action == 'restartPlayer':
                    player_uid = int(open('/etc/ezplayer-pi-player-uid').read().strip())
                    player = pwd.getpwuid(player_uid).pw_name
                    command = ['/usr/sbin/runuser', '-u', player, '--', '/usr/bin/env',
                               'XDG_RUNTIME_DIR=/run/user/' + str(player_uid),
                               'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/' + str(player_uid) + '/bus',
                               '/usr/bin/systemctl', '--user', 'restart', 'ezplayer-desktop.service']
                else:
                    command = ['/usr/bin/systemctl', 'reboot' if action == 'reboot' else 'poweroff']
                threading.Timer(2, lambda: subprocess.run(command, check=False)).start()
                return {'ok': True}
            raise ValueError('Unsupported action')


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(60)
        _, uid, _ = struct.unpack('3i', self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        try:
            line = self.rfile.readline(16385)
            if len(line) > 16384 or not line.endswith(b'\n'):
                raise ValueError('Invalid request size')
            result = self.server.appliance.request(json.loads(line), uid)
            response = {'ok': True, 'data': result}
        except ValueError as exc:
            response = {'ok': False, 'error': str(exc)}
        except Exception:
            response = {'ok': False, 'error': 'Pi service operation failed. Check NetworkManager and system services.'}
        self.wfile.write((json.dumps(response) + '\n').encode())


if __name__ == '__main__':
    path = '/run/ezplayer-pi/control.sock'
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        os.unlink(path)
    from pi_hotspot import Hotspot
    hotspot = Hotspot(NetworkManager)
    appliance = Appliance(NetworkManager(), hotspot)
    threading.Thread(target=hotspot.run, daemon=True).start()
    with socketserver.UnixStreamServer(path, Handler) as server:
        os.chown(path, 0, grp.getgrnam('ezplayer-system').gr_gid)
        os.chmod(path, 0o660)
        server.appliance = appliance
        server.serve_forever()
