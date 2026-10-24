"""Setup hotspot policy. Network changes are performed through NetworkManager D-Bus."""
import json
import os
from pathlib import Path
import threading
import time

ADDRESS = '192.168.4.1'
MODES = ('auto', 'off')
CONFIG_PATH = '/var/lib/ezplayer-pi/hotspot.json'


def save_config(path, config):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix('.tmp')
    with open(temp, 'w', opener=lambda p, flags: os.open(p, flags, 0o600)) as out:
        json.dump(config, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(temp, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Hotspot:
    def __init__(self, network_factory, config_path=CONFIG_PATH, clock=time.monotonic):
        self.factory = network_factory
        self.config_path = config_path
        self.clock = clock
        self.lock = threading.RLock()
        self.started = clock()
        self.offline_since = self.started
        self.last_action = self.started
        self.busy = False
        self.error = ''
        self.setup = None
        self.rotation = None
        try:
            self.config = json.loads(Path(config_path).read_text())
            if self.config['mode'] == 'on':
                self.config['mode'] = 'auto'
                save_config(config_path, self.config)
            if self.config['mode'] not in MODES:
                raise ValueError('Invalid saved tethering mode')
        except FileNotFoundError:
            self.config = {'mode': 'auto', 'ssid': 'EZPlayer',
                           'password': 'Ezrgb123', 'interface': ''}
            save_config(config_path, self.config)

    def status(self):
        with self.lock:
            devices = self.factory().status()
            active = next((d for d in devices if d.get('wifiMode') == 'ap' and d.get('ssid') == self.config['ssid'] and d['state'] == 100), None)
            return {'mode': self.config['mode'], 'ssid': self.config['ssid'],
                    'password': self.config['password'], 'active': active is not None,
                    'interface': active['name'] if active else self.config['interface'],
                    'url': 'http://' + ADDRESS, 'error': self.error, 'setup': self.setup}

    def set_mode(self, mode, ssid=None, password=None):
        if mode not in MODES:
            raise ValueError('Choose Auto or Off')
        with self.lock:
            if self.busy or self.rotation:
                raise ValueError('Wait for the Wi-Fi change to finish')
            updated = {**self.config, 'mode': mode}
            if ssid is not None:
                if not isinstance(ssid, str) or not 1 <= len(ssid.encode('utf-8')) <= 32 or any(ord(c) < 32 or ord(c) == 127 for c in ssid):
                    raise ValueError('Setup Wi-Fi name must contain 1–32 bytes without control characters')
                updated['ssid'] = ssid
            if password is not None:
                if not isinstance(password, str) or not 8 <= len(password) <= 63 or any(ord(c) < 32 or ord(c) > 126 for c in password):
                    raise ValueError('Setup Wi-Fi password must contain 8–63 printable ASCII characters')
                updated['password'] = password
            changed = any(updated[k] != self.config[k] for k in ('ssid', 'password'))
            current = self.status()
            save_config(self.config_path, updated)
            if changed and current['active']:
                self.rotation = (current['interface'], self.config['ssid'])
            self.config = updated
            self.error = ''
            self.last_action = self.clock()  # Receive the response before restarting setup Wi-Fi.
        return {'ok': True, 'reconnect': bool(changed and current['active'])}

    def tick(self):
        with self.lock:
            if self.busy or self.clock() - self.last_action < 3:
                return
            network = self.factory()
            if self.rotation:
                network.stop_hotspot(*self.rotation)
                self.rotation = None
            devices = [d for d in network.status() if d['type'] == 'wifi']
            active = next((d for d in devices if d.get('wifiMode') == 'ap' and d.get('ssid') == self.config['ssid'] and d['state'] == 100), None)
            connected = any(d['state'] == 100 and d.get('wifiMode') != 'ap' for d in devices)
            if connected:
                self.offline_since = None
            elif self.offline_since is None:
                self.offline_since = self.clock()
            wanted = self.config['mode'] == 'auto' and not connected
            if not wanted:
                if active:
                    network.stop_hotspot(active['name'], self.config['ssid'])
                self.error = ''
                return
            if active:
                return
            # Let NM try remembered Wi-Fi at startup / following a dropped connection.
            if self.config['mode'] == 'auto' and self.clock() - self.offline_since < 45:
                return
            free = [d for d in devices if d['state'] != 100 and d.get('wifiMode') != 'ap' and d.get('apSupported', True)]
            if not free:
                self.error = 'Setup Wi-Fi needs an available Wi-Fi adapter with access point support.'
                return
            selected = next((d for d in free if d['name'] == self.config['interface']), free[-1])
            self.config['interface'] = selected['name']
            save_config(self.config_path, self.config)
            self.last_action = self.clock()
            network.activate_hotspot(selected['name'], self.config)
            self.error = ''

    def queue_wifi(self, req):
        with self.lock:
            if self.busy or self.rotation:
                raise ValueError('A Wi-Fi connection attempt is already in progress')
            network = self.factory()
            network.validate_wifi(req)
            network.device(req.get('interface'), 2)
            self.busy = True
            self.setup = {'state': 'connecting', 'ssid': req['ssid']}
            worker = threading.Timer(2, self._join, args=(dict(req),))
            worker.daemon = True
            worker.start()
            return {'connecting': True, 'message': 'Connecting to Wi-Fi. Your phone may disconnect. If the connection fails, rejoin the setup hotspot.'}

    def _join(self, req):
        network = None
        checkpoint = None
        try:
            network = self.factory()
            checkpoint = network.checkpoint(req['interface'])
            network.activate(req, wifi=True)
            # The phone cannot confirm after its setup Wi-Fi disappears. Only confirm
            # after NM verifies the requested infrastructure connection is activated.
            network.confirm(checkpoint)
            self.setup = {'state': 'connected', 'ssid': req['ssid']}
        except Exception:
            if checkpoint is not None:
                try:
                    network.rollback(checkpoint)
                except Exception:
                    pass  # NM's checkpoint timer is a second recovery path.
            self.setup = {'state': 'failed', 'ssid': req['ssid'],
                          'error': 'Wi-Fi connection failed. Check the network name and password and try again.'}
        finally:
            with self.lock:
                self.busy = False
                self.last_action = self.clock()
            self.tick()

    def run(self):
        while True:
            try:
                self.tick()
            except Exception:
                with self.lock:
                    self.error = 'Setup hotspot could not start. Check Wi-Fi adapter AP support and NetworkManager.'
                    self.last_action = self.clock()
            time.sleep(5)
