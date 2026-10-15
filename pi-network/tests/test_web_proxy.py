"""Optional integration test: NGINX_BINARY=/path/to/nginx python3 tests/test_web_proxy.py.
Runs an isolated nginx against mock player and real portal handlers. No Pi required.
"""
import base64,hashlib,http.client,http.server,importlib.util,json,os,pathlib,socket,subprocess,tempfile,threading,time,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).parents[1]
spec=importlib.util.spec_from_file_location('proxy_service',ROOT/'network_service.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class Player(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path=='/ws':
   key=base64.b64encode(hashlib.sha1((self.headers['Sec-WebSocket-Key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
   self.send_response(101);self.send_header('Upgrade','websocket');self.send_header('Connection','Upgrade');self.send_header('Sec-WebSocket-Accept',key);self.end_headers();self.wfile.write(b'\x81\x04live');self.wfile.flush();return
  body=('player:'+self.path).encode();self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def do_POST(self):
  length=int(self.headers.get('Content-Length',0));self.rfile.read(length);body=str(length).encode();self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
@unittest.skipUnless(os.environ.get('NGINX_BINARY'),'Set NGINX_BINARY for proxy integration tests')
class Routing(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory();d=pathlib.Path(cls.tmp.name)
  cls.patches=[patch.object(s,'PROXY_MODE',True),patch.object(s,'address',return_value='127.0.0.1/8'),patch.object(s,'config',return_value={'password':'Ezrgb1234'}),patch.object(s,'get_status',return_value={'wifi':{'connected':True}})]
  for p in cls.patches:p.start()
  cls.servers=[];ports=[]
  for handler in [Player,s.Handler]:
   server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler);cls.servers.append(server);ports.append(server.server_port);threading.Thread(target=server.serve_forever,daemon=True).start()
  listener=socket.socket();listener.bind(('127.0.0.1',0));cls.port=listener.getsockname()[1];listener.close()
  config=(ROOT/'ezplayer-web.conf').read_text().replace('listen 80 default_server',f'listen {cls.port} default_server').replace('127.0.0.1:3000',f'127.0.0.1:{ports[0]}').replace('127.0.0.1:8081',f'127.0.0.1:{ports[1]}')
  # Simulate LAN context while retaining nginx's overriding of spoofed headers.
  config=config.replace('"192.168.4.1:/" 1;', '"192.168.4.1:/" 1; "127.0.0.2:/" 1;')
  config=config.replace('X-EZPlayer-Client-IP $remote_addr','X-EZPlayer-Client-IP 192.168.1.103')
  (d/'nginx.conf').write_text(f'user root root; pid {d}/nginx.pid; error_log {d}/error.log; events {{ worker_connections 128; }} http {{ client_body_temp_path {d}/body; proxy_temp_path {d}/proxy; fastcgi_temp_path {d}/fastcgi; uwsgi_temp_path {d}/uwsgi; scgi_temp_path {d}/scgi; {config} }}')
  cls.proc=subprocess.Popen([os.environ['NGINX_BINARY'],'-p',str(d),'-c',str(d/'nginx.conf'),'-g','daemon off; master_process off;'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(100):
   if cls.proc.poll() is not None:raise RuntimeError(cls.proc.stderr.read().decode()+((d/'error.log').read_text() if (d/'error.log').exists() else ''))
   try:
    c=socket.create_connection(('127.0.0.1',cls.port),timeout=.1);c.close();break
   except OSError:time.sleep(.03)
  else:raise RuntimeError('Proxy did not start')
 @classmethod
 def tearDownClass(cls):
  cls.proc.terminate();cls.proc.wait(timeout=5);cls.proc.stderr.close()
  for server in cls.servers:server.shutdown();server.server_close()
  for p in cls.patches:p.stop()
  cls.tmp.cleanup()
 def request(self,path,method='GET',body=None,headers=None):
  c=http.client.HTTPConnection('127.0.0.1',self.port);c.request(method,path,body,headers or {});r=c.getresponse();result=(r.status,r.read(),dict(r.getheaders()));c.close();return result
 def test_player_root_cloud_assets_and_api(self):
  for path in ['/','/cloud','/assets/test.js','/api/ezp/hello']:
   code,body,_=self.request(path);self.assertEqual(code,200);self.assertEqual(body,('player:'+path).encode())
 def test_large_player_upload(self):
  code,body,_=self.request('/api/ezp/upload','POST',b'x'*(2*1024*1024));self.assertEqual(code,200);self.assertEqual(body,b'2097152')
 def test_setup_and_spoofed_loopback_header(self):
  code,body,headers=self.request('/setup');self.assertEqual(code,200);self.assertIn(b'Home Wi-Fi',body);self.assertIn(b'data:image/png;base64,',body);self.assertIn("img-src 'self' data:",headers['Content-Security-Policy'])
  self.assertEqual(self.request('/api/network/status',headers={'X-EZPlayer-Client-IP':'127.0.0.1'})[0],200)
 def test_portal_login_and_csrf(self):
  code,_,headers=self.request('/api/network/login','POST',json.dumps({'password':'Ezrgb1234'}),{'Content-Type':'application/json'});self.assertEqual(code,200)
  cookie=headers['Set-Cookie'];code,body,_=self.request('/api/network/status',headers={'Cookie':cookie});self.assertEqual(code,200);self.assertIn('token',json.loads(body))
  self.assertEqual(self.request('/api/network/lan','POST','{}',{'Content-Type':'application/json','Cookie':cookie})[0],403)
 def test_probe_redirects_and_shell_guard(self):
  for path in ['/generate_204','/hotspot-detect.html','/connecttest.txt']:
   code,_,headers=self.request(path,headers={'Host':'captive.apple.com'});self.assertEqual(code,302);self.assertEqual(headers['Location'],'http://127.0.0.1/setup')
  for path in ['/api/ezp/shell/reload','/api/ezp/shell/reload/','/API/EZP/SHELL/RELOAD']:
   self.assertEqual(self.request(path,'POST')[0],403)
 def test_hotspot_root_reserved_for_setup(self):
  c=http.client.HTTPConnection('127.0.0.2',self.port)
  c.request('GET','/?firstboot=1');r=c.getresponse();self.assertEqual(r.status,302);self.assertTrue(r.getheader('Location').endswith('/setup'));r.read();c.close()
  c=http.client.HTTPConnection('127.0.0.2',self.port)
  c.request('GET','/player');r=c.getresponse();self.assertEqual(r.status,200);self.assertEqual(r.read(),b'player:/player');c.close()
 def test_unknown_captive_host_redirects(self):
  for path in ['/','/vendor-specific-probe']:
   code,_,headers=self.request(path,headers={'Host':'connectivity.example.com'});self.assertEqual(code,302);self.assertEqual(headers['Location'],'http://127.0.0.1/setup')
 def test_websocket_live_frames(self):
  with socket.create_connection(('127.0.0.1',self.port),timeout=3) as c:
   c.sendall(b'GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n')
   received=b''
   while b'\x81\x04live' not in received:received+=c.recv(4096)
   self.assertIn(b'101 Switching Protocols',received)
if __name__=='__main__':unittest.main()
