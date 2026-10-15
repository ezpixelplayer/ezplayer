import importlib.util, pathlib, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('service',pathlib.Path(__file__).parents[1]/'network_service.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class Validation(unittest.TestCase):
 def test_unicode_ssid_bytes(self):
  self.assertEqual(s.validate_ssid('House Wi-Fi'),'House Wi-Fi')
  with self.assertRaises(ValueError):s.validate_ssid('灯'*11)
 def test_config_injection(self):
  for text in ('House\nchannel=11',''):
   with self.assertRaises(ValueError):s.validate_ssid(text)
  with self.assertRaises(ValueError):s.validate_password('password\nwpa=0')
 def test_password(self):
  self.assertEqual(s.validate_password('',True),'')
  self.assertEqual(s.validate_password('Ezrgb1234'),'Ezrgb1234')
  with self.assertRaises(ValueError):s.validate_password('short')
 def test_channels(self):
  self.assertEqual(s.channel(2412),(1,'g'));self.assertEqual(s.channel(2462),(11,'g'))
  self.assertEqual(s.channel(5180),(36,'a'))
  with self.assertRaises(ValueError):s.channel(6115)
 def test_escaped_nmcli(self):self.assertEqual(s.fields(r'House\: Main:80:WPA2'),['House: Main','80','WPA2'])
 def lan(self,**changes):return s.validate_lan({**dict(mode='manual',ip='192.168.50.10',subnet='255.255.255.0',gateway='',dns='',controllerOnly=True),**changes})
 def test_lan_valid(self):self.assertEqual(self.lan()['prefix'],24)
 def test_lan_bad_masks(self):
  for mask in ('255.0.255.0','0.0.0.255'):
   with self.assertRaises(ValueError):s.validate_lan(dict(mode='manual',ip='192.168.50.10',subnet=mask,controllerOnly=True))
 def test_lan_hotspot_overlap(self):
  with self.assertRaises(ValueError):s.validate_lan(dict(mode='manual',ip='192.168.4.20',subnet='255.255.255.0',controllerOnly=True))
 def test_gateway_outside_subnet(self):
  with self.assertRaises(ValueError):self.lan(gateway='10.0.0.1')
 def test_config_reset_preserves_country(self):
  with tempfile.TemporaryDirectory() as d,patch.object(s,'STATE',pathlib.Path(d)):
   s.write_config(dict(ssid='EZPLAYER',password='Ezrgb1234',country='US'))
   self.assertEqual(s.config()['country'],'US');self.assertEqual((pathlib.Path(d)/'hotspot.json').stat().st_mode&0o777,0o600)
 def test_failure_releases_operation_lock(self):
  s.LOCK.acquire()
  with patch.object(s,'apply_wifi',side_effect=RuntimeError('secret password')):s.operation('wifi',{})
  self.assertFalse(s.LOCK.locked());self.assertNotIn('secret',s.ERROR)
if __name__=='__main__':unittest.main()

class HTTPAccess(unittest.TestCase):
 def setUp(self):
  import threading,http.server
  self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),s.Handler)
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
 def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join()
 def request(self,path,method='GET',headers=None,body=None):
  import http.client
  c=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
  c.request(method,path,body=body,headers=headers or {'Host':s.HOTSPOT_IP})
  r=c.getresponse();result=(r.status,r.read());c.close();return result
 def test_probe_redirect(self):self.assertEqual(self.request('/generate_204')[0],302)
 def test_rebinding_host_redirect(self):self.assertEqual(self.request('/api/network/status',headers={'Host':'attacker.example'})[0],403)
 def test_unauthenticated_post(self):self.assertEqual(self.request('/api/network/hotspot','POST')[0],403)
 def test_foreign_origin(self):
  headers={'Host':s.HOTSPOT_IP,'X-EZPlayer-Token':s.TOKEN,'Origin':'http://attacker.example'}
  self.assertEqual(self.request('/api/network/hotspot','POST',headers)[0],403)
 def test_status_contract(self):
  import json
  with patch.object(s,'get_status',return_value={'busy':False,'hotspot':{'ssid':'EZPLAYER'}}):
   code,body=self.request('/api/network/status')
  self.assertEqual(code,200);result=json.loads(body);self.assertEqual(result['token'],s.TOKEN);self.assertNotIn('password',body.decode())

class BandSelection(unittest.TestCase):
 def test_default_auto(self):self.assertNotIn('band',s.wifi_settings({'ssid':'Home'}))
 def test_explicit_5(self):self.assertEqual(s.wifi_settings({'ssid':'Home','band':'a'})['band'],'a')
 def test_auto_no_restriction(self):self.assertNotIn('band',s.wifi_settings({'ssid':'Home','band':'auto'}))
 def test_bad_band_rejected(self):
  with self.assertRaises(ValueError):s.wifi_settings({'ssid':'Home','band':'invalid'})

class SavedPassword(unittest.TestCase):
 def test_typed_password_unchanged(self):
  data={'ssid':'Home','password':'newpassword'}
  self.assertEqual(s.resolve_wifi_password(data),data)
 def test_saved_password_requires_same_network(self):
  with patch.object(s,'wifi_snapshot',return_value={'savedSsid':'Other','profile':'uuid'}):
   with self.assertRaises(ValueError):s.resolve_wifi_password({'ssid':'Home','password':'','useSavedPassword':True})
 def test_reuse_secret_stays_internal(self):
  data={'ssid':'Home','password':'','useSavedPassword':True}
  with patch.object(s,'wifi_snapshot',return_value={'savedSsid':'Home','profile':'uuid'}),patch.object(s,'nm',side_effect=['Home','savedpassword']):
   self.assertEqual(s.resolve_wifi_password(data)['password'],'savedpassword')
 def test_status_details_do_not_read_secret(self):
  with tempfile.TemporaryDirectory() as d,patch.object(s,'STATE',pathlib.Path(d)),patch.object(s,'nm',side_effect=['100 (connected)','uuid','Home','bg','wpa-psk']) as nm:
   self.assertEqual(s.active_wifi_details(),{'band':'bg','hasSavedPassword':True})
   self.assertTrue(all('--show-secrets' not in c.args for c in nm.call_args_list))

class StatusRegression(unittest.TestCase):
 def test_nm_connected_when_iw_ssid_missing(self):
  with tempfile.TemporaryDirectory() as d,patch.object(s,'STATE',pathlib.Path(d)),patch.object(s,'link',return_value=(None,2437)),patch.object(s,'nm',side_effect=['100 (connected)','uuid','JARVIS','a','wpa-psk']):
   status=s.wifi_snapshot()
  self.assertTrue(status['connected']);self.assertEqual(status['ssid'],'JARVIS');self.assertEqual(status['band'],'a')
 def test_disconnect_preserves_saved_form_but_not_connected_label(self):
  with tempfile.TemporaryDirectory() as d,patch.object(s,'STATE',pathlib.Path(d)):
   (pathlib.Path(d)/'wifi-display.json').write_text('{"ssid":"JARVIS","band":"auto","hasSavedPassword":true,"profile":"uuid"}')
   with patch.object(s,'nm',side_effect=['30 (disconnected)','--']):status=s.wifi_snapshot()
  self.assertFalse(status['connected']);self.assertIsNone(status['ssid']);self.assertEqual(status['savedSsid'],'JARVIS');self.assertEqual(status['band'],'auto')

class LANRestore(unittest.TestCase):
 def test_manual_settings_read_without_carrier(self):
  with patch.object(s,'nm',side_effect=['--','manual','192.168.50.10/24','','1.1.1.1','yes']):settings=s.lan_settings()
  self.assertEqual(settings['mode'],'manual');self.assertEqual(settings['address'],'192.168.50.10');self.assertEqual(settings['subnet'],'255.255.255.0');self.assertTrue(settings['controllerOnly'])
 def test_save_without_cable_does_not_activate(self):
  data=s.validate_lan(dict(mode='manual',ip='192.168.50.10',subnet='255.255.255.0',gateway='',dns='',controllerOnly=True))
  with tempfile.TemporaryDirectory() as d,patch.object(s,'STATE',pathlib.Path(d)),patch.object(s,'nm',return_value='') as nm,patch.object(pathlib.Path,'read_text',side_effect=OSError):s.apply_lan(data)
  self.assertTrue(any(call.args[:2]==('connection','modify') for call in nm.call_args_list))
  self.assertFalse(any(call.args[:2]==('connection','up') for call in nm.call_args_list))

class ExplicitReveal(HTTPAccess):
 def test_password_requires_token(self):
  self.assertEqual(self.request('/api/network/wifi-password','POST',{'Host':s.HOTSPOT_IP,'Content-Type':'application/json'},'{"ssid":"Home"}')[0],403)
 def test_authenticated_explicit_reveal(self):
  import json
  with patch.object(s,'resolve_wifi_password',return_value={'password':'testpassword'}):
   code,body=self.request('/api/network/wifi-password','POST',{'Host':s.HOTSPOT_IP,'Content-Type':'application/json','X-EZPlayer-Token':s.TOKEN},'{"ssid":"Home"}')
  self.assertEqual(code,200);self.assertEqual(json.loads(body)['password'],'testpassword')

class LANAuthentication(unittest.TestCase):
 def setUp(self):
  HTTPAccess.setUp(self)
  self.local=patch.object(s.Handler,'local_access',return_value=False);self.local.start()
  self.config=patch.object(s,'config',return_value={'password':'Ezrgb1234'});self.config.start()
  s.SESSIONS.clear();s.LOGIN_ATTEMPTS.clear()
 def tearDown(self):
  HTTPAccess.tearDown(self);self.config.stop();self.local.stop()
 def request(self,path,method='GET',body=None,cookie=None,origin=None):
  import http.client,json
  c=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
  headers={'Host':'127.0.0.1'}
  if body is not None:headers['Content-Type']='application/json'
  if cookie:headers['Cookie']=cookie
  if origin:headers['Origin']=origin
  c.request(method,path,body=json.dumps(body) if body is not None else None,headers=headers)
  r=c.getresponse();result=(r.status,r.read(),r.getheader('Set-Cookie'));c.close();return result
 def test_lan_status_requires_signin(self):
  code,body,_=self.request('/api/network/status');self.assertEqual(code,401);self.assertNotIn('token',body.decode())
 def test_wrong_password_rejected(self):self.assertEqual(self.request('/api/network/login','POST',{'password':'bad'})[0],401)
 def test_cookie_enables_status_and_password_change_invalidates(self):
  code,_,cookie=self.request('/api/network/login','POST',{'password':'Ezrgb1234'});self.assertEqual(code,200);self.assertIn('HttpOnly',cookie)
  with patch.object(s,'get_status',return_value={'wifi':{}}):self.assertEqual(self.request('/api/network/status',cookie=cookie)[0],200)
  with patch.object(s,'config',return_value={'password':'differentpassword'}):self.assertEqual(self.request('/api/network/status',cookie=cookie)[0],401)
 def test_cross_origin_login_rejected(self):self.assertEqual(self.request('/api/network/login','POST',{'password':'Ezrgb1234'},origin='http://attacker.example')[0],403)
 def test_login_attempt_limit(self):
  for _ in range(5):self.request('/api/network/login','POST',{'password':'bad'})
  self.assertEqual(self.request('/api/network/login','POST',{'password':'bad'})[0],429)

class PortalModes(unittest.TestCase):
 def test_ezrgb_preset_ignores_submitted_values(self):
  data=s.validate_lan({'mode':'ezrgb','ip':'10.0.0.2','gateway':'10.0.0.1','dns':'8.8.8.8','controllerOnly':False})
  self.assertEqual((data['ip'],data['prefix'],data['gateway'],data['dns'],data['controllerOnly']),('192.168.25.1',24,'','',True))
 def test_ezrgb_restored_and_manual_not_mislabeled(self):
  with tempfile.TemporaryDirectory() as d,patch.object(s,'STATE',pathlib.Path(d)):
   (pathlib.Path(d)/'lan-mode.json').write_text('{"mode":"ezrgb"}')
   with patch.object(s,'nm',side_effect=['--','manual','192.168.25.1/24','','','yes']):self.assertEqual(s.lan_settings()['mode'],'ezrgb')
   with patch.object(s,'nm',side_effect=['--','manual','192.168.25.2/24','','','yes']):self.assertEqual(s.lan_settings()['mode'],'manual')
 def test_wifi_ip_validation(self):
  with self.assertRaises(ValueError):s.validate_wifi_ip({'mode':'ezrgb'})
  with self.assertRaises(ValueError):s.validate_wifi_ip({'mode':'manual','ip':'192.168.4.10','subnet':'255.255.255.0'})
  self.assertFalse(s.validate_wifi_ip({'mode':'auto','controllerOnly':True})['controllerOnly'])
 def test_wifi_manual_restored(self):
  with patch.object(s,'nm',side_effect=['192.168.99.107/24','manual','192.168.99.1','1.1.1.1']):
   self.assertEqual(s.wifi_ip_settings('uuid'),{'mode':'manual','ip':'192.168.99.107','subnet':'255.255.255.0','gateway':'192.168.99.1','dns':'1.1.1.1'})
 def test_wifi_ip_requires_connection(self):
  with patch.object(s,'wifi_snapshot',return_value={'profile':'uuid','connected':False}),patch.object(s,'nm') as nm:
   with self.assertRaises(ValueError):s.apply_wifi_ip({'mode':'auto'})
   nm.assert_not_called()
 def test_wifi_ip_failure_rolls_back_and_restarts_hotspot(self):
  data=s.validate_wifi_ip({'mode':'manual','ip':'192.168.99.108','subnet':'255.255.255.0','gateway':'192.168.99.1','dns':''})
  calls=[]
  def fake_nm(*args):
   calls.append(args)
   if args[:2]==('-g','ipv4.method'):return 'auto'
   if args[0]=='-g':return ''
   if args[:2]==('connection','up') and sum(c[:2]==('connection','up') for c in calls)==1:raise RuntimeError('failure')
   return ''
  with patch.object(s,'wifi_snapshot',return_value={'profile':'uuid','connected':True}),patch.object(s,'nm',side_effect=fake_nm),patch.object(s,'run'),patch.object(s,'link',return_value=('Home',2437)),patch.object(s.AP_SERVICE,'stop'),patch.object(s.AP_SERVICE,'start') as start:
   with self.assertRaises(RuntimeError):s.apply_wifi_ip(data)
   start.assert_called_once_with(2437)
  modifications=[c for c in calls if c[:2]==('connection','modify')]
  self.assertEqual(len(modifications),2);self.assertEqual(modifications[-1][5],'auto')

class ProxyAuthentication(unittest.TestCase):
 request=HTTPAccess.request
 def setUp(self):
  HTTPAccess.setUp(self);self.proxy=patch.object(s,'PROXY_MODE',True);self.proxy.start()
  self.config=patch.object(s,'config',return_value={'password':'Ezrgb1234'});self.config.start()
  s.SESSIONS.clear();s.LOGIN_ATTEMPTS.clear()
 def tearDown(self):
  HTTPAccess.tearDown(self);self.proxy.stop();self.config.stop()
 def headers(self,**extra):return {'Host':'192.168.99.107','X-EZPlayer-Client-IP':'192.168.1.103','X-EZPlayer-Server-IP':'192.168.99.107',**extra}
 def test_proxy_cannot_bypass_lan_login(self):
  self.assertEqual(self.request('/api/network/status',headers=self.headers())[0],401)
 def test_hotspot_proxy_direct_access(self):
  with patch.object(s,'get_status',return_value={}):
   self.assertEqual(self.request('/api/network/status',headers=self.headers(Host='192.168.4.1',**{'X-EZPlayer-Client-IP':'192.168.4.20','X-EZPlayer-Server-IP':'192.168.4.1'}))[0],200)
 def test_untrusted_missing_forwarding_context_rejected(self):
  self.assertEqual(self.request('/api/network/status',headers={'Host':'127.0.0.1'})[0],403)
 def test_invalid_forwarded_address_rejected(self):
  self.assertEqual(self.request('/api/network/status',headers=self.headers(**{'X-EZPlayer-Client-IP':'bad'}))[0],403)
 def test_cookie_bound_to_forwarded_peer(self):
  import http.client,json
  c=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
  c.request('POST','/api/network/login',body=json.dumps({'password':'Ezrgb1234'}),headers=self.headers(**{'Content-Type':'application/json'}))
  r=c.getresponse();self.assertEqual(r.status,200);cookie=r.getheader('Set-Cookie');r.read();c.close()
  with patch.object(s,'get_status',return_value={}):
   self.assertEqual(self.request('/api/network/status',headers=self.headers(Cookie=cookie))[0],200)
   self.assertEqual(self.request('/api/network/status',headers=self.headers(Cookie=cookie,**{'X-EZPlayer-Client-IP':'192.168.1.104'}))[0],401)

class HotspotPasswordLimits(unittest.TestCase):
 def test_hotspot_accepts_boundaries(self):
  for value in ['a'*8,'a'*20]:self.assertEqual(s.validate_hotspot_password(value),value)
 def test_hotspot_rejects_outside_boundaries(self):
  for value in ['','a'*7,'a'*21]:
   with self.assertRaises(ValueError):s.validate_hotspot_password(value)
 def test_home_wifi_still_accepts_long_password(self):self.assertEqual(s.validate_password('a'*63),'a'*63)
