"""NGINX_BINARY and NGINX_STREAM_MODULE enable real TLS passthrough tests."""
import importlib.util, os, pathlib, socket, ssl, subprocess, tempfile, threading, unittest

spec = importlib.util.spec_from_file_location('tls_gateway', pathlib.Path(__file__).parents[1] / 'hotspot_gateway.py')
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)

@unittest.skipUnless(os.environ.get('NGINX_BINARY') and os.environ.get('NGINX_STREAM_MODULE'), 'Nginx stream module required')
class Passthrough(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(); d = pathlib.Path(cls.tmp.name)
        cls.cert, cls.key = d/'cert.pem', d/'key.pem'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=ezrgb.com','-addext','subjectAltName=DNS:ezrgb.com','-keyout',str(cls.key),'-out',str(cls.cert)], check=True, capture_output=True)
        cls.backend = socket.socket(); cls.backend.bind(('127.0.0.1',0)); cls.backend.listen(); cls.backend.settimeout(.2)
        cls.running = True
        def serve():
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); context.load_cert_chain(cls.cert, cls.key)
            while cls.running:
                try: conn, _ = cls.backend.accept()
                except (TimeoutError, OSError): continue
                try:
                    with context.wrap_socket(conn, server_side=True) as tls:
                        tls.recv(1024); tls.sendall(b'allowed TLS service')
                except (OSError, ssl.SSLError): conn.close()
        cls.thread = threading.Thread(target=serve, daemon=True); cls.thread.start()
        with socket.socket() as sock: sock.bind(('127.0.0.1',0)); cls.port = sock.getsockname()[1]
        config = g.nginx_config().replace('/usr/lib/nginx/modules/ngx_stream_module.so',os.environ['NGINX_STREAM_MODULE'])
        config = config.replace('user ezplayer-gateway;', 'user root root;').replace('/run/ezplayer-gateway',str(d))
        config = config.replace('listen 0.0.0.0:8443;', f'listen 127.0.0.1:{cls.port};')
        # The real exact hostname map is retained; map all allowed destinations
        # to one fixture IP to ensure foreign names at that same IP stay denied.
        for host in g.DOMAINS: config = config.replace(f'{host} {host}:443;',f'{host} 127.0.0.1:{cls.backend.getsockname()[1]};')
        p = d/'nginx.conf'; p.write_text(config)
        subprocess.run([os.environ['NGINX_BINARY'],'-t','-p',str(d),'-c',str(p)],check=True,capture_output=True)
        cls.proc = subprocess.Popen([os.environ['NGINX_BINARY'],'-p',str(d),'-c',str(p),'-g','daemon off; master_process off;'],stderr=subprocess.PIPE)
        import time
        for _ in range(100):
            try:
                with socket.create_connection(('127.0.0.1',cls.port),timeout=.1): break
            except OSError:
                if cls.proc.poll() is not None: raise RuntimeError(cls.proc.stderr.read().decode())
                time.sleep(.02)
        else: raise RuntimeError('gateway did not start')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate(); cls.proc.wait(timeout=5); cls.proc.stderr.close()
        cls.running = False; cls.backend.close(); cls.thread.join(timeout=2); cls.tmp.cleanup()

    def test_allowed_hostname_keeps_end_to_end_certificate_validation(self):
        context = ssl.create_default_context(cafile=str(self.cert))
        with socket.create_connection(('127.0.0.1',self.port),timeout=3) as raw:
            with context.wrap_socket(raw,server_hostname='ezrgb.com') as tls:
                tls.sendall(b'test'); self.assertEqual(tls.recv(1024),b'allowed TLS service')

    def test_foreign_suffix_shared_hosting_and_missing_sni_denied(self):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT); context.check_hostname = False; context.verify_mode = ssl.CERT_NONE
        for host in ['example.com','ezrgb.com.evil.example','other.fly.dev',None]:
            with self.subTest(host=host):
                with socket.create_connection(('127.0.0.1',self.port),timeout=3) as raw:
                    with self.assertRaises((OSError,ssl.SSLError)):
                        with context.wrap_socket(raw,server_hostname=host): self.fail('unapproved TLS handshake succeeded')
