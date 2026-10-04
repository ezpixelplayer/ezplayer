import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pi_service', Path(__file__).parents[1] / 'pi_service.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class FakeNetwork:
    def __init__(self):
        self.events = []
        self.fail = False
    def device(self, name, expected=None):
        if name not in ('eth0', 'wlan0') or (expected == 1 and name != 'eth0') or (expected == 2 and name != 'wlan0'):
            raise ValueError('Unsupported interface')
        return name, {}
    def checkpoint(self, name):
        self.events.append(('checkpoint', name))
        return 'checkpoint-1'
    def activate(self, req, wifi=False):
        self.events.append(('activate', req['interface']))
        if self.fail:
            raise RuntimeError('secret password must not leak')
    def rollback(self, checkpoint): self.events.append(('rollback', checkpoint))
    def confirm(self, checkpoint): self.events.append(('confirm', checkpoint))
    def status(self): return []
    def scan(self, name): return [{'ssid': 'Home', 'security': 'personal', 'signal': 80}]


class ValidationTests(unittest.TestCase):
    def test_static_controller_has_no_default_route(self):
        value = m.ipv4_config({'method': 'manual', 'address': '192.168.50.2/24', 'controllerOnly': True})
        self.assertTrue(value['never-default'])
        self.assertEqual(value['address-data'], [{'address': '192.168.50.2', 'prefix': 24}])
    def test_controller_gateway_rejected(self):
        with self.assertRaises(ValueError):
            m.ipv4_config({'method': 'auto', 'controllerOnly': True, 'gateway': '192.168.1.1'})
    def test_invalid_addresses_rejected(self):
        for addr in ('bad', '192.168.1.2/33', '::1/64', '127.0.0.1/8', '224.0.0.1/24'):
            with self.subTest(addr=addr), self.assertRaises(ValueError):
                m.ipv4_config({'method': 'manual', 'address': addr})
    def test_dns_validated(self):
        with self.assertRaises(ValueError): m.ipv4_config({'method': 'auto', 'dns': ['bad']})
    def test_boolean_is_not_coerced(self):
        with self.assertRaises(ValueError): m.ipv4_config({'method': 'auto', 'controllerOnly': 'false'})
    def test_shell_text_rejected_as_ip(self):
        with self.assertRaises(ValueError): m.ipv4_config({'method': 'manual', 'address': '$(touch /tmp/bad)'})


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.network = FakeNetwork()
        self.app = m.Appliance(self.network)
        self.req = {'action': 'ethernet', 'interface': 'eth0', 'method': 'auto', 'controllerOnly': True}
    def test_confirm_and_pending_lock(self):
        result = self.app.request(self.req, 1000)
        with self.assertRaises(ValueError): self.app.request(self.req, 1000)
        self.app.request({'action': 'confirm', 'token': result['token']}, 1000)
        self.assertIsNone(self.app.pending)
        self.assertEqual(self.network.events[-1], ('confirm', 'checkpoint-1'))
    def test_other_uid_and_wrong_token_cannot_confirm(self):
        result = self.app.request(self.req, 1000)
        for uid, token in ((1001, result['token']), (1000, 'bad')):
            with self.assertRaises(ValueError): self.app.request({'action': 'confirm', 'token': token}, uid)
        self.assertIsNotNone(self.app.pending)
    def test_failure_rolls_back_and_redacts_error(self):
        self.network.fail = True
        with self.assertRaisesRegex(ValueError, '^Connection failed;') as exc: self.app.request(self.req, 1000)
        self.assertNotIn('secret', str(exc.exception))
        self.assertEqual(self.network.events[-1], ('rollback', 'checkpoint-1'))
        self.assertIsNone(self.app.pending)
    def test_revert(self):
        result = self.app.request(self.req, 1000)
        self.app.request({'action': 'revert', 'token': result['token']}, 1000)
        self.assertEqual(self.network.events[-1], ('rollback', 'checkpoint-1'))
    def test_expiry_rejects_confirmation(self):
        result = self.app.request(self.req, 1000)
        self.app.pending['expires'] = 0
        with self.assertRaises(ValueError): self.app.request({'action': 'confirm', 'token': result['token']}, 1000)
    def test_wrong_interface_rejected_before_checkpoint(self):
        with self.assertRaises(ValueError): self.app.request({**self.req, 'interface': 'wlan0'}, 1000)
        self.assertEqual(self.network.events, [])
    def test_invalid_static_rejected_before_checkpoint(self):
        with self.assertRaises(ValueError): self.app.request({**self.req, 'method': 'manual', 'address': 'bad'}, 1000)
        self.assertEqual(self.network.events, [])
    def test_unknown_action_and_path_traversal(self):
        with self.assertRaises(ValueError): self.app.request({'action': 'shell', 'command': 'id'}, 1000)
        with self.assertRaises(ValueError): self.app.request({'action': 'timezone', 'timezone': '../../etc/passwd'}, 1000)
    def test_power_blocked_during_change(self):
        self.app.request(self.req, 1000)
        with self.assertRaises(ValueError): self.app.request({'action': 'shutdown'}, 1000)
    def test_timezone_uses_argument_array(self):
        with patch.object(m.os.path, 'isfile', return_value=True), patch.object(m.subprocess, 'run') as run:
            self.app.request({'action': 'timezone', 'timezone': 'America/New_York'}, 1000)
            self.assertEqual(run.call_args.args[0], ['/usr/bin/timedatectl', 'set-timezone', 'America/New_York'])



class FakeDBus:
    Boolean = staticmethod(bool)
    UInt32 = staticmethod(int)
    Int32 = staticmethod(int)
    ByteArray = staticmethod(bytes)
    ObjectPath = staticmethod(str)
    @staticmethod
    def Dictionary(value, signature=None): return dict(value)
    @staticmethod
    def Array(value, signature=None): return list(value)


class DBusProfileTests(unittest.TestCase):
    def backend(self):
        from types import SimpleNamespace
        backend = object.__new__(m.NetworkManager)
        backend.d = FakeDBus()
        backend.device = lambda name, expected=None: ('device-1', {})
        backend.props = lambda path, kind: {'State': 100, 'ActiveConnection': 'new-active'}
        self.settings = None
        def activate(settings, path, specific):
            self.settings = settings
            return 'new-profile', 'new-active'
        backend.manager = SimpleNamespace(AddAndActivateConnection=activate)
        return backend
    def test_ethernet_profile_defaults_and_ip_types(self):
        backend = self.backend()
        backend.activate({'interface': 'eth0', 'method': 'manual', 'address': '192.168.50.2/24', 'controllerOnly': True})
        self.assertEqual(self.settings['connection']['type'], '802-3-ethernet')
        self.assertEqual(self.settings['ipv6']['method'], 'disabled')
        self.assertTrue(self.settings['ipv4']['never-default'])
        self.assertTrue(self.settings['ipv4']['ignore-auto-dns'])
        self.assertEqual(self.settings['ipv4']['address-data'][0]['prefix'], 24)
    def test_wifi_secret_is_passed_as_dbus_profile(self):
        backend = self.backend()
        with patch.object(m.subprocess, 'run') as run:
            backend.activate({'interface': 'wlan0', 'ssid': 'Home', 'security': 'personal', 'password': 'testpassword'}, wifi=True)
            run.assert_not_called()
        self.assertEqual(self.settings['802-11-wireless']['ssid'], b'Home')
        self.assertEqual(self.settings['802-11-wireless-security']['psk'], 'testpassword')
    def test_open_wifi_does_not_store_secret(self):
        backend = self.backend()
        backend.activate({'interface': 'wlan0', 'ssid': 'Guest', 'security': 'open'}, wifi=True)
        self.assertNotIn('802-11-wireless-security', self.settings)
    def test_unsupported_security_and_bad_password_rejected(self):
        for security, password in [('enterprise', 'testpassword'), ('personal', 'short')]:
            with self.subTest(security=security), self.assertRaises(ValueError):
                self.backend().activate({'interface': 'wlan0', 'ssid': 'Home', 'security': security, 'password': password}, wifi=True)
    def test_activation_waits_for_new_connection_not_old_one(self):
        backend = self.backend()
        calls = iter([{'State': 100, 'ActiveConnection': 'old-active'}, {'State': 100, 'ActiveConnection': 'new-active'}])
        backend.props = lambda path, kind: next(calls)
        with patch.object(m.time, 'sleep') as sleep:
            backend.activate({'interface': 'eth0', 'method': 'auto'})
            sleep.assert_called_once()

if __name__ == '__main__': unittest.main()
