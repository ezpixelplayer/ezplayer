import importlib.util, json, pathlib, unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gateway', pathlib.Path(__file__).parents[1] / 'hotspot_gateway.py')
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)

class Gateway(unittest.TestCase):
    def test_exact_tls_hosts_no_shared_hosting_wildcards(self):
        cfg = g.nginx_config()
        self.assertIn('ssl_preread on;', cfg)
        self.assertIn('default unix:', cfg)
        for host in g.DOMAINS: self.assertIn(f'{host} {host}:443;', cfg)
        self.assertNotIn('*.fly.dev', cfg)
        self.assertNotIn('proxy_ssl on', cfg)
        self.assertNotIn('ssl_certificate', cfg)

    def test_firewall_blocks_forwarding_private_destinations_and_other_egress(self):
        rules = g.firewall(1234, False)
        self.assertIn('iifname "ezsetup0" drop', rules)
        self.assertIn('oifname "ezsetup0" drop', rules)
        self.assertIn('meta skuid 1234 meta nfproto != ipv4 drop', rules)
        self.assertIn('192.168.0.0/16', rules)
        self.assertIn('ct direction reply accept', rules)
        self.assertIn('oifname "wlan0" tcp dport 443 accept', rules)
        self.assertIn('meta skuid 1234 drop', rules)
        self.assertNotIn('masquerade', rules)
        self.assertNotIn('flush ruleset', rules)
        self.assertTrue(g.firewall(1234, True).startswith('delete table inet ezplayer_gateway\n'))

    def test_route_uses_only_wifi_and_removes_it_without_a_gateway(self):
        with patch.object(g, 'command') as cmd:
            cmd.return_value.stdout = json.dumps([{'dev':'wlan0','gateway':'192.168.99.1','metric':600}])
            g.update_route()
            args = cmd.call_args.args
            self.assertIn('wlan0', args); self.assertNotIn('eth0', args)
            self.assertIn('192.168.99.1', args); self.assertIn(g.TABLE, args)
            cmd.return_value.stdout = '[]'
            g.update_route()
            self.assertEqual(cmd.call_args.args[:4], ('ip','-4','route','del'))

    def test_invalid_gateway_is_rejected_before_route_mutation(self):
        with patch.object(g, 'command') as cmd:
            cmd.return_value.stdout = '[{"dev":"wlan0","gateway":"1.2.3.4; bad"}]'
            with self.assertRaises(ValueError): g.update_route()
            self.assertEqual(cmd.call_count, 1)

    def test_no_route_changes_if_firewall_fails(self):
        def command(*args, **kwargs):
            if args[:2] == ('nft','list'): return SimpleNamespace(returncode=1)
            raise RuntimeError('firewall failure')
        with patch.object(g.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=1234)), patch.object(g, 'command', side_effect=command) as cmd:
            with self.assertRaises(RuntimeError): g.prepare()
            self.assertTrue(all(c.args[0] == 'nft' for c in cmd.call_args_list))

    def test_dns_does_not_enable_general_resolving(self):
        self.assertEqual(g.dns_arguments(), [f'--server=/{host}/1.1.1.1@wlan0' for host in g.DOMAINS] + ['--filter-AAAA', '--filter-rr=HTTPS,SVCB'])
