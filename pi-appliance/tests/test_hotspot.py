import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))
from pi_hotspot import Hotspot
from pi_service import NetworkManager
from setup_portal import player_port, setup_client
import setup_portal
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer


class FakeNetwork:
    def __init__(self):
        self.devices = [{'name': 'wlan0', 'type': 'wifi', 'state': 30, 'wifiMode': 'infrastructure', 'ssid': ''}]
        self.events = []
        self.fail = False

    def status(self): return [dict(d) for d in self.devices]
    def device(self, name, expected=None):
        if not any(d['name'] == name for d in self.devices):
            raise ValueError('Unsupported interface')
        return name, {}
    validate_wifi = staticmethod(NetworkManager.validate_wifi)

    def activate_hotspot(self, name, config):
        self.events.append(('hotspot', name))
        for d in self.devices:
            if d['name'] == name:
                d.update(state=100, wifiMode='ap', ssid=config['ssid'])

    def stop_hotspot(self, name, ssid):
        self.events.append(('stop', name))
        for d in self.devices:
            if d['name'] == name:
                d.update(state=30, wifiMode='infrastructure', ssid='')

    def checkpoint(self, name):
        self.events.append(('checkpoint', name))
        self.previous = self.status()
        return 'checkpoint'
    def activate(self, req, wifi=False):
        self.events.append(('wifi', req['interface']))
        if self.fail:
            raise ValueError('bad secret password')
        for d in self.devices:
            if d['name'] == req['interface']:
                d.update(state=100, wifiMode='infrastructure', ssid=req['ssid'])
    def confirm(self, checkpoint): self.events.append(('confirm', checkpoint))
    def rollback(self, checkpoint):
        self.events.append(('rollback', checkpoint))
        self.devices = self.previous


class HotspotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'hotspot.json'
        self.time = 0
        self.network = FakeNetwork()
        self.hotspot = Hotspot(lambda: self.network, self.path, lambda: self.time)
        self.req = {'interface': 'wlan0', 'ssid': 'Home', 'security': 'personal', 'password': 'testpassword'}

    def start(self):
        self.time = 50
        self.hotspot.tick()

    def test_auto_waits_for_saved_wifi_before_starting(self):
        self.time = 20
        self.hotspot.tick()
        self.assertEqual(self.network.events, [])
        self.start()
        self.assertTrue(self.hotspot.status()['active'])

    def test_setup_credentials_persist_with_restricted_permissions(self):
        again = Hotspot(lambda: self.network, self.path)
        self.assertEqual(again.config, self.hotspot.config)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(again.config['ssid'], 'EZPlayer')
        self.assertEqual(again.config['password'], 'Ezrgb123')

    def test_connected_ethernet_does_not_suppress_auto(self):
        self.network.devices.append({'name': 'eth0', 'type': 'ethernet', 'state': 100})
        self.start()
        self.assertTrue(self.hotspot.status()['active'])

    def test_connected_home_wifi_suppresses_auto(self):
        self.network.devices[0].update(state=100)
        self.start()
        self.assertFalse(self.hotspot.status()['active'])

    def test_second_adapter_hotspot_turns_off_after_wifi_connects(self):
        self.network.devices.append({'name': 'wlan1', 'type': 'wifi', 'state': 30})
        self.start()
        self.assertEqual(self.hotspot.status()['interface'], 'wlan1')
        self.network.devices[0].update(state=100)
        self.time += 5
        self.hotspot.tick()
        self.assertEqual(self.network.events[-1], ('stop', 'wlan1'))

    def test_off_survives_restart_and_stops_hotspot(self):
        self.start()
        self.hotspot.set_mode('off')
        self.assertTrue(self.hotspot.status()['active'])  # HTTP response gets time to return.
        self.time += 5
        self.hotspot.tick()
        self.assertFalse(self.hotspot.status()['active'])
        self.assertEqual(Hotspot(lambda: self.network, self.path).config['mode'], 'off')

    def test_old_always_on_configuration_migrates_to_auto(self):
        config = {**self.hotspot.config, 'mode': 'on'}
        self.path.write_text(json.dumps(config))
        restored = Hotspot(lambda: self.network, self.path)
        self.assertEqual(restored.config['mode'], 'auto')
        self.assertEqual(json.loads(self.path.read_text())['mode'], 'auto')
        with self.assertRaises(ValueError): restored.set_mode('on')

    def test_credentials_restart_active_hotspot_after_response(self):
        self.start()
        old_ssid = self.network.devices[0]['ssid']
        result = self.hotspot.set_mode('auto', 'My Player', 'new-password')
        self.assertTrue(result['reconnect'])
        self.assertEqual(self.network.devices[0]['ssid'], old_ssid)
        self.time += 5
        self.hotspot.tick()
        self.assertEqual(self.network.events[-2:], [('stop', 'wlan0'), ('hotspot', 'wlan0')])
        self.assertEqual(self.network.devices[0]['ssid'], 'My Player')
        restored = Hotspot(lambda: self.network, self.path)
        self.assertEqual(restored.config['password'], 'new-password')
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_invalid_credentials_leave_saved_config_and_radio_unchanged(self):
        original = self.path.read_text()
        for ssid, password in [('', 'valid-password'), ('x' * 33, 'valid-password'), ('bad\nname', 'valid-password'), ('valid', 'short'), ('valid', 'x' * 64), ('valid', 'nonasciié')]:
            with self.assertRaises(ValueError): self.hotspot.set_mode('auto', ssid, password)
            self.assertEqual(self.path.read_text(), original)
        self.assertEqual(self.network.events, [])

    def test_off_with_new_credentials_stops_without_restarting(self):
        self.start()
        self.hotspot.set_mode('off', 'New Player', 'new-password')
        self.time += 5
        self.hotspot.tick()
        self.assertEqual(self.network.events[-1], ('stop', 'wlan0'))
        self.assertFalse(self.hotspot.status()['active'])

    def test_invalid_mode_and_password_do_not_change_network(self):
        with self.assertRaises(ValueError): self.hotspot.set_mode('bad')
        with self.assertRaises(ValueError): self.hotspot.queue_wifi({**self.req, 'password': 'short'})
        self.assertEqual(self.network.events, [])

    def test_wifi_handoff_delayed_then_confirmed_without_phone(self):
        self.start()
        with patch('pi_hotspot.threading.Timer') as timer:
            result = self.hotspot.queue_wifi(self.req)
            self.assertTrue(result['connecting'])
            self.assertEqual(timer.call_args.args[0], 2)
            self.assertEqual(self.network.events, [('hotspot', 'wlan0')])
        self.hotspot._join(self.req)
        self.assertEqual(self.network.events[-1], ('confirm', 'checkpoint'))
        self.assertFalse(self.hotspot.status()['active'])
        self.assertEqual(self.hotspot.setup['state'], 'connected')

    def test_bad_credentials_restore_hotspot_without_leaking_secret(self):
        self.start()
        self.network.fail = True
        self.hotspot.busy = True
        self.hotspot._join(self.req)
        self.assertTrue(self.hotspot.status()['active'])
        self.assertEqual(self.network.events[-1], ('rollback', 'checkpoint'))
        self.assertEqual(self.hotspot.setup['state'], 'failed')
        self.assertNotIn('secret', json.dumps(self.hotspot.setup))
        self.assertFalse(self.hotspot.busy)

    def test_loss_of_home_wifi_allows_reconnection_grace(self):
        self.network.devices[0].update(state=100)
        self.start()
        self.network.devices[0].update(state=30)
        self.time = 100
        self.hotspot.tick()
        self.assertFalse(self.hotspot.status()['active'])
        self.time = 150
        self.hotspot.tick()
        self.assertTrue(self.hotspot.status()['active'])

    def test_busy_rejects_mode_changes_and_second_join(self):
        self.hotspot.busy = True
        with self.assertRaises(ValueError): self.hotspot.set_mode('off')
        with self.assertRaises(ValueError): self.hotspot.queue_wifi(self.req)


class PortalTests(unittest.TestCase):
    def test_portal_only_accepts_setup_interface_and_subnet(self):
        self.assertTrue(setup_client('192.168.4.1', '192.168.4.20'))
        for local, remote in [('192.168.99.107', '192.168.4.20'), ('192.168.4.1', '192.168.99.20'), ('192.168.4.1', 'invalid')]:
            self.assertFalse(setup_client(local, remote))

    def test_port_is_loaded_from_registration_and_rejects_arbitrary_targets(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'port.json'
            path.write_text('{"port":3007}')
            self.assertEqual(player_port(path), 3007)
            for value in ['http://evil', 80, True, 65536]:
                path.write_text(json.dumps({'port': value}))
                with self.assertRaises(ValueError): player_port(path)


class PortalHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        async def handler(req):
            if req.path == '/ws':
                ws = web.WebSocketResponse()
                await ws.prepare(req)
                async for msg in ws:
                    await ws.send_str(msg.data)
                return ws
            return web.json_response({'path': req.path, 'origin': req.headers.get('Origin'),
                                      'body': (await req.read()).decode()})
        player = web.Application()
        player.router.add_route('*', '/{tail:.*}', handler)
        self.player = TestServer(player)
        await self.player.start_server()
        self.port = self.player.port
        self.client = TestClient(TestServer(setup_portal.create_app()))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        await self.player.close()

    async def test_captive_probe_lands_on_network_settings(self):
        with patch.object(setup_portal, 'setup_client', return_value=True):
            response = await self.client.get('/hotspot-detect.html', headers={'Host': 'captive.apple.com'}, allow_redirects=False)
        self.assertEqual(response.status, 302)
        self.assertEqual(response.headers['Location'], 'http://192.168.4.1/playbacksettings?section=piNetwork')

    async def test_setup_proxy_preserves_api_origin_and_body(self):
        with patch.object(setup_portal, 'setup_client', return_value=True), patch.object(setup_portal, 'player_port', return_value=self.port):
            response = await self.client.post('/api/ezp/pi', headers={'Host': '192.168.4.1', 'Origin': 'http://192.168.4.1'}, json={'action': 'status'})
            value = await response.json()
        self.assertEqual(value['origin'], 'http://192.168.4.1')
        self.assertEqual(json.loads(value['body']), {'action': 'status'})

    async def test_player_tabs_and_websocket_remain_accessible(self):
        with patch.object(setup_portal, 'setup_client', return_value=True), patch.object(setup_portal, 'player_port', return_value=self.port):
            response = await self.client.get('/player', headers={'Host': '192.168.4.1'})
            self.assertEqual((await response.json())['path'], '/player')
            ws = await self.client.ws_connect('/ws', headers={'Host': '192.168.4.1'})
            await ws.send_str('player-state')
            self.assertEqual((await ws.receive()).data, 'player-state')
            await ws.close()

    async def test_other_interfaces_are_not_proxied(self):
        response = await self.client.get('/api/ezp/pi', headers={'Host': '192.168.4.1'})
        self.assertEqual(response.status, 404)

    async def test_unknown_host_cannot_submit_credentials(self):
        with patch.object(setup_portal, 'setup_client', return_value=True):
            response = await self.client.post('/api/ezp/pi', headers={'Host': 'evil.example'}, json={'action': 'wifi'})
        self.assertEqual(response.status, 403)


if __name__ == '__main__': unittest.main()
