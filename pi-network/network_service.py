#!/usr/bin/env python3
"""EZPlayer local network provisioning service. Requires root on Raspberry Pi OS."""
import argparse, hashlib, http.cookies, http.server, ipaddress, json, os, pathlib, secrets, socket, subprocess, threading, time
from urllib.parse import urlsplit
ROOT = pathlib.Path(__file__).resolve().parent
STATE = pathlib.Path('/var/lib/ezplayer-network')
RUNTIME = pathlib.Path('/run/ezplayer-network')
AP = 'ezsetup0'
WIFI = 'wlan0'
HOTSPOT_IP = '192.168.4.1'
TOKEN = secrets.token_urlsafe(32)
LOCK = threading.Lock()
ERROR = ''
SESSIONS = {}
LOGIN_ATTEMPTS = {}
AUTH_LOCK = threading.Lock()
PROXY_MODE = os.environ.get('EZPLAYER_PROXY_MODE') == '1'

def run(*args, timeout=40):
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        # Command output can contain credentials. Never expose it to HTTP or logs.
        raise RuntimeError('Network operation failed; inspect interface configuration.')
    return p.stdout.strip()

def nm(*args):
    return run('nmcli', '--wait', '30', *args)

def fields(line):
    result, current, escaped = [], '', False
    for c in line:
        if escaped: current += c; escaped = False
        elif c == '\\': escaped = True
        elif c == ':': result.append(current); current = ''
        else: current += c
    result.append(current)
    return result

def validate_ssid(s):
    if not isinstance(s,str) or not 1 <= len(s.encode()) <= 32 or any(ord(c)<32 for c in s):
        raise ValueError('Network name must contain 1–32 bytes and no control characters.')
    return s

def validate_password(p, allow_open=False):
    if not isinstance(p,str) or (p=='' and not allow_open) or (p and not 8<=len(p)<=63) or any(ord(c)<32 or ord(c)>126 for c in p):
        raise ValueError('Use an 8–63 character ASCII password, or leave blank for an open Wi-Fi network.')
    return p

def validate_hotspot_password(value):
    validate_password(value)
    if len(value)>20:raise ValueError('Use an 8–20 character hotspot password.')
    return value

def validate_band(value):
    if value not in ('auto','bg','a'):
        raise ValueError('Choose Auto, 2.4 GHz or 5 GHz.')
    return value

def wifi_settings(data):
    settings={'mode':'infrastructure','ssid':';'.join(str(b) for b in data['ssid'].encode())+';','hidden':'true','powersave':'2'}
    band=validate_band(data.get('band','auto'))
    if band!='auto':settings['band']=band
    return settings

def validate_lan(data):
    if data.get('mode')=='ezrgb':
        # Enforce the preset on the Pi, regardless of submitted editable fields.
        data={'mode':'manual','displayMode':'ezrgb','ip':'192.168.25.1','subnet':'255.255.255.0','gateway':'','dns':'','controllerOnly':True}
    if data.get('mode') not in ('auto','manual') or type(data.get('controllerOnly')) is not bool:
        raise ValueError('Invalid LAN mode.')
    if data['mode']=='auto': return data
    mask=ipaddress.IPv4Address(data['subnet'])
    if not str(mask).startswith('255.'):
        raise ValueError('Use a subnet mask such as 255.255.255.0.')
    net = ipaddress.IPv4Network(f"{data['ip']}/{data['subnet']}", strict=False)
    addr = ipaddress.IPv4Address(data['ip'])
    if addr in (net.network_address,net.broadcast_address) or net.overlaps(ipaddress.IPv4Network('192.168.4.0/24')):
        raise ValueError('LAN address must be a usable host outside the setup hotspot subnet.')
    gateway = data.get('gateway','') or ''
    if gateway and ipaddress.IPv4Address(gateway) not in net: raise ValueError('Gateway must be within the LAN subnet.')
    dns = data.get('dns','') or ''
    for item in dns.split(','):
        if item.strip(): ipaddress.IPv4Address(item.strip())
    return {**data,'prefix':net.prefixlen,'gateway':gateway,'dns':dns}

def validate_wifi_ip(data):
    if data.get('mode') not in ('auto','manual'):
        raise ValueError('Choose DHCP or Manual IP Address.')
    return validate_lan({**data,'controllerOnly':False})

def wifi_ip_settings(profile):
    if not profile:return None
    def value(key):return nm('-g',key,'connection','show','uuid',profile)
    try:
        raw=value('ipv4.addresses').split(',')[0].strip()
        interface=ipaddress.IPv4Interface(raw) if raw and raw!='--' else None
        return {'mode':'manual' if value('ipv4.method')=='manual' else 'auto','ip':str(interface.ip) if interface else '', 'subnet':str(interface.netmask) if interface else '', 'gateway':value('ipv4.gateway').replace('--',''),'dns':value('ipv4.dns').replace('--','')}
    except Exception:return None

def apply_wifi_ip(data):
    info=wifi_snapshot();profile=info.get('profile')
    if not profile or not info.get('connected'):
        raise ValueError('Connect to Home Wi-Fi before changing its IP settings.')
    keys=['ipv4.method','ipv4.addresses','ipv4.gateway','ipv4.dns','ipv4.ignore-auto-dns','ipv4.never-default']
    old=[nm('-g',key,'connection','show','uuid',profile).replace('--','') for key in keys]
    values=[data['mode'],'' if data['mode']=='auto' else f"{data['ip']}/{data['prefix']}",data.get('gateway','') if data['mode']=='manual' else '',data.get('dns','') if data['mode']=='manual' else '','no','no']
    def modify(values):
        args=['connection','modify','uuid',profile]
        for key,value in zip(keys,values):args.extend([key,value])
        nm(*args)
    AP_SERVICE.stop()
    try:
        run('ip','link','set',AP,'down')
        modify(values);nm('connection','up','uuid',profile,'ifname',WIFI)
    except Exception:
        try:modify(old);nm('connection','up','uuid',profile,'ifname',WIFI)
        except Exception:pass
        raise
    finally:AP_SERVICE.start(link()[1])

def config():
    return json.loads((STATE/'hotspot.json').read_text())

def write_config(data):
    STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    tmp=STATE/'hotspot.tmp'
    with open(tmp,'w') as f:
        os.chmod(tmp,0o600);json.dump(data,f)
    tmp.replace(STATE/'hotspot.json')

def link():
    try:
        text=run('iw','dev',WIFI,'link',timeout=3)
        ssid=next((x.strip()[6:] for x in text.splitlines() if x.strip().startswith('SSID: ')),None)
        freq=next((int(x.strip()[6:]) for x in text.splitlines() if x.strip().startswith('freq: ')),None)
        return ssid,freq
    except Exception: return None,None

def channel(freq):
    if freq is None:return 6,'g'
    if freq==2484:return 14,'g'
    if 2412<=freq<=2472:return (freq-2407)//5,'g'
    if 5000<freq<5900:return (freq-5000)//5,'a'
    raise ValueError('Unsupported Wi-Fi band for this setup hotspot.')

def address(dev):
    try:return nm('-g','IP4.ADDRESS','device','show',dev).split('\n')[0] or None
    except Exception:return None

class Hotspot:
    def __init__(self):
        self.host=None;self.dns=None;self.freq=None
        self.started=0;self.last_check=0;self.last_recovery=0
        self.missing_since=None;self.candidate=None;self.candidate_count=0
        self.control_failures=0;self.state='STARTING';self.reported_frequency=None
    def control_status(self):
        output=run('hostapd_cli','-p',str(RUNTIME/'hostapd'),'-i',AP,'status',timeout=3)
        status=dict(line.split('=',1) for line in output.splitlines() if '=' in line)
        if not status.get('state'):raise RuntimeError('Hotspot control interface is not responding.')
        return status
    def maintain(self,freq,now=None):
        now=time.monotonic() if now is None else now
        if freq is None:
            if self.missing_since is None:self.missing_since=now
            self.candidate=None;self.candidate_count=0
            # Preserve the last channel across transient iw/association failures.
            target=self.freq if now-self.missing_since<20 else None
        else:
            self.missing_since=None;target=freq
            if freq!=self.freq:
                if self.candidate==freq:self.candidate_count+=1
                else:self.candidate=freq;self.candidate_count=1
                if self.candidate_count>=2:
                    print(f'Hotspot channel follow: {self.freq} -> {freq} MHz',flush=True)
                    self.start(freq);return
            else:self.candidate=None;self.candidate_count=0
        if target is None and self.freq is not None:
            print('Home Wi-Fi channel unavailable for 20 seconds; restoring setup channel.',flush=True)
            self.start(None);return
        if not self.host or self.host.poll() is not None:
            self.state='UNAVAILABLE'
            if now-self.started>=5:
                print('Hotspot recovery: daemon exited.',flush=True);self.start(target)
            return
        if now-self.last_check<5:return
        self.last_check=now
        try:
            status=self.control_status();self.state=status['state'];self.reported_frequency=int(status.get('freq','0'))
            expected=self.freq or 2437
            healthy=self.state=='ENABLED' and self.reported_frequency==expected
            # Regulatory radar checks can legitimately take several minutes.
            settling=(self.state=='DFS' and now-self.started<660) or (self.state in ('COUNTRY_UPDATE','ACS','HT_SCAN','SET_FREQ','UNINITIALIZED') and now-self.started<30)
            if healthy or settling:self.control_failures=0;return
        except Exception:self.state='UNRESPONSIVE'
        if now-self.started<30:return
        self.control_failures+=1
        if self.control_failures>=3 and now-self.last_recovery>=30:
            print(f'Hotspot recovery: control state {self.state}.',flush=True)
            self.start(target)
    def available(self):
        return bool(self.host and self.host.poll() is None and self.state=='ENABLED' and self.reported_frequency==(self.freq or 2437))
    def stop(self):
        if self.host:
            self.host.terminate()
            try:self.host.wait(timeout=5)
            except subprocess.TimeoutExpired:self.host.kill();self.host.wait()
            self.host=None
    def start(self,freq=None):
        self.stop();run('ip','link','set',AP,'down');run('ip','link','set',AP,'up');ch,band=channel(freq);cfg=config()
        RUNTIME.mkdir(mode=0o700,parents=True,exist_ok=True)
        # Hex SSID avoids hostapd config injection. Password is validated before persistence.
        contents=f'ctrl_interface={RUNTIME}/hostapd\nlogger_stdout=-1\nlogger_stdout_level=2\nlogger_syslog=0\ninterface={AP}\ndriver=nl80211\nssid2={cfg["ssid"].encode().hex()}\nhw_mode={band}\nchannel={ch}\ncountry_code={cfg["country"]}\nieee80211d=1\nieee80211h=1\nwmm_enabled=1\nauth_algs=1\nwpa=2\nwpa_key_mgmt=WPA-PSK\nrsn_pairwise=CCMP\nwpa_passphrase={cfg["password"]}\n'
        path=RUNTIME/'hostapd.conf';path.write_text(contents);os.chmod(path,0o600)
        self.host=subprocess.Popen(['hostapd',str(path)])
        self.freq=freq;self.started=time.monotonic();self.last_recovery=self.started;self.last_check=self.started
        self.control_failures=0;self.state='STARTING';self.candidate=None;self.candidate_count=0;self.missing_since=None;self.reported_frequency=None
        print(f'Hotspot starting on channel {ch} ({band}), frequency {freq or 2437} MHz.',flush=True)
    def initialize(self):
        # Do not silently take over an existing hotspot on wlan0.
        existing=run('iw','dev')
        if 'type AP' in existing and f'Interface {AP}' not in existing:raise RuntimeError('An existing hotspot must be disabled before starting EZPlayer setup.')
        if f'Interface {AP}' not in existing:run('iw','dev',WIFI,'interface','add',AP,'type','__ap')
        run('ip','addr','replace',HOTSPOT_IP+'/24','dev',AP);run('ip','link','set',AP,'up')
        ssid,freq=link();self.start(freq)
        gateway_dns=[]
        if pathlib.Path('/etc/ezplayer-gateway.conf').exists():
            from hotspot_gateway import dns_arguments
            gateway_dns=dns_arguments()
        self.dns=subprocess.Popen(['dnsmasq','--keep-in-foreground','--conf-file=/dev/null','--interface='+AP,'--bind-dynamic','--listen-address='+HOTSPOT_IP,'--dhcp-range=192.168.4.20,192.168.4.200,255.255.255.0,12h','--dhcp-option=3,'+'192.168.4.1','--dhcp-option=6,'+'192.168.4.1','--address=/#/'+HOTSPOT_IP,'--no-resolv','--dhcp-authoritative',*gateway_dns],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    def close(self):
        self.stop()
        if self.dns:
            self.dns.terminate()
            try:self.dns.wait(timeout=5)
            except subprocess.TimeoutExpired:self.dns.kill();self.dns.wait()

AP_SERVICE=Hotspot()

def scan():
    output=nm('-t','-f','SSID,SIGNAL,SECURITY','device','wifi','list','ifname',WIFI,'--rescan','yes')
    networks={}
    for line in output.splitlines():
        f=fields(line)
        if len(f)==3 and f[0]:
            item={'ssid':f[0],'signal':int(f[1]),'security':'open' if f[2] in ('','--') else f[2]}
            if f[0] not in networks or item['signal']>networks[f[0]]['signal']:networks[f[0]]=item
    return sorted(networks.values(),key=lambda n:-n['signal'])

def apply_wifi(data):
    # Create a protected NM keyfile: do not put passwords into process arguments.
    import configparser, uuid
    profile='ezplayer-wifi-'+uuid.uuid4().hex
    parser=configparser.ConfigParser(interpolation=None)
    parser['connection']={'id':profile,'uuid':str(uuid.uuid4()),'type':'wifi','interface-name':WIFI,'autoconnect':'true'}
    # SSID byte list preserves leading/trailing spaces and special characters.
    parser['wifi']=wifi_settings(data)
    if data['password']:parser['wifi-security']={'key-mgmt':'wpa-psk','psk':data['password'].replace('\\','\\\\').replace(' ','\\s')}
    info=wifi_snapshot()
    saved=wifi_ip_settings(info.get('profile')) if info.get('savedSsid')==data['ssid'] else None
    parser['ipv4']={'method':'auto','route-metric':'100','dhcp-hostname':'EZPlayer','dhcp-send-hostname':'true'}
    if saved and saved['mode']=='manual':
        saved=validate_wifi_ip(saved)
        parser['ipv4'].update({'method':'manual','address1':f"{saved['ip']}/{saved['prefix']}"+((','+saved['gateway']) if saved['gateway'] else ''),'dns':saved['dns'].replace(',',';').replace(' ','')})
    parser['ipv6']={'method':'auto'}
    path=pathlib.Path('/etc/NetworkManager/system-connections')/(profile+'.nmconnection')
    old=nm('-g','GENERAL.CON-UUID','device','show',WIFI)
    with open(path,'w') as f:os.chmod(path,0o600);parser.write(f)
    nm('connection','load',str(path));AP_SERVICE.stop()
    try:
        run('ip','link','set',AP,'down')
        nm('connection','up',profile,'ifname',WIFI)
        assigned=address(WIFI)
        if assigned and ipaddress.IPv4Interface(assigned).network.overlaps(ipaddress.IPv4Network('192.168.4.0/24')):
            raise ValueError('Home Wi-Fi overlaps the setup subnet 192.168.4.0/24. A different setup subnet is required.')
        # Remove only older profiles owned by this service after success.
        for row in nm('-t','-f','UUID,NAME','connection','show').splitlines():
            f=fields(row)
            if len(f)==2 and f[1].startswith('ezplayer-wifi-') and f[1]!=profile:nm('connection','delete','uuid',f[0])
    except Exception:
        nm('connection','delete',profile)
        if old and old!='--':
            try:nm('connection','up','uuid',old,'ifname',WIFI)
            except Exception:pass
        raise
    finally:AP_SERVICE.start(link()[1])

def apply_lan(data):
    name='ezplayer-lan'
    try:nm('connection','show',name)
    except Exception:nm('connection','add','type','ethernet','ifname','eth0','con-name',name)
    args=['connection','modify',name,'ipv4.method', 'auto' if data['mode']=='auto' else 'manual','ipv4.never-default','yes' if data['controllerOnly'] else 'no','ipv4.dhcp-hostname','EZPlayer','ipv4.dhcp-send-hostname','yes','ipv4.route-metric','200','ipv6.method','disabled' if data['controllerOnly'] else 'auto']
    args+=['ipv4.addresses', '' if data['mode']=='auto' else f"{data['ip']}/{data['prefix']}",'ipv4.gateway','' if data['controllerOnly'] or data['mode']=='auto' else data['gateway'],'ipv4.dns','' if data['mode']=='auto' else data['dns'],'ipv4.ignore-auto-dns','yes' if data['controllerOnly'] else 'no']
    nm(*args)
    STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    marker=STATE/'lan-mode.tmp'
    with open(marker,'w') as f:
        os.chmod(marker,0o600);json.dump({'mode':data.get('displayMode',data['mode'])},f)
    marker.replace(STATE/'lan-mode.json')
    # Persist even when no cable is present; activate when a carrier is available.
    try:carrier=pathlib.Path('/sys/class/net/eth0/carrier').read_text().strip()=='1'
    except OSError:carrier=False
    if carrier:nm('connection','up',name,'ifname','eth0')

def lan_settings():
    try:
        profile=nm('-g','GENERAL.CON-UUID','device','show','eth0')
        if not profile or profile=='--':profile='ezplayer-lan'
        def value(key):return nm('-g',key,'connection','show',profile)
        mode=value('ipv4.method')
        raw=value('ipv4.addresses').split(',')[0].strip()
        interface=ipaddress.IPv4Interface(raw) if raw and raw!='--' else None
        settings={'mode':'manual' if mode=='manual' else 'auto','address':str(interface.ip) if interface else '', 'subnet':str(interface.netmask) if interface else '', 'gateway':value('ipv4.gateway').replace('--',''),'dns':value('ipv4.dns').replace('--',''),'controllerOnly':value('ipv4.never-default')=='yes'}
        try:display_mode=json.loads((STATE/'lan-mode.json').read_text()).get('mode')
        except (OSError,ValueError):display_mode=None
        if display_mode=='ezrgb' and settings=={'mode':'manual','address':'192.168.25.1','subnet':'255.255.255.0','gateway':'','dns':'','controllerOnly':True}:
            settings['mode']='ezrgb'
        return settings
    except Exception:return None

def operation(kind,data):
    global ERROR
    try:
        if kind=='wifi':apply_wifi(resolve_wifi_password(data))
        elif kind=='lan':apply_lan(data)
        elif kind=='wifi-ip':apply_wifi_ip(data)
        else:write_config({**config(),**data});AP_SERVICE.start(link()[1])
        ERROR=''
    except Exception as e:ERROR=str(e) if isinstance(e,ValueError) else 'Network settings could not be applied. Previous Wi-Fi was restored when possible.'
    finally:LOCK.release()

def watcher():
    while True:
        time.sleep(1)
        if LOCK.acquire(blocking=False):
            try:
                AP_SERVICE.maintain(link()[1])
            except Exception:pass
            finally:LOCK.release()

def wifi_snapshot():
    """Read association/profile from NM; iw can omit SSID in AP+STA mode."""
    saved_path=STATE/'wifi-display.json'
    try:saved=json.loads(saved_path.read_text())
    except (OSError,ValueError):saved={}
    connected=False
    try:
        state=nm('-g','GENERAL.STATE','device','show',WIFI)
        connected=state.split()[0]=='100'
        profile=nm('-g','GENERAL.CON-UUID','device','show',WIFI)
        if connected and profile and profile!='--':
            ssid=nm('-g','802-11-wireless.ssid','connection','show','uuid',profile)
            band=nm('-g','802-11-wireless.band','connection','show','uuid',profile)
            key=nm('-g','802-11-wireless-security.key-mgmt','connection','show','uuid',profile)
            current={'ssid':ssid,'band':band if band in ('bg','a') else 'auto','hasSavedPassword':key in ('wpa-psk','sae'),'profile':profile}
            if current!=saved:
                STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
                tmp=STATE/('wifi-display-'+secrets.token_hex(6)+'.tmp')
                with open(tmp,'w') as f:
                    os.chmod(tmp,0o600);json.dump(current,f)
                tmp.replace(saved_path)
            saved=current
    except Exception:
        # A missing SSID must not override a confirmed connected device state.
        pass
    return {'connected':connected,'ssid':saved.get('ssid') if connected else None,'savedSsid':saved.get('ssid'),'band':saved.get('band','auto'),'hasSavedPassword':saved.get('hasSavedPassword',False),'profile':saved.get('profile')}

def active_wifi_details():
    info=wifi_snapshot()
    return {'band':info['band'],'hasSavedPassword':info['hasSavedPassword']}

def resolve_wifi_password(data):
    if not data.get('useSavedPassword'):return data
    info=wifi_snapshot()
    if info['savedSsid']!=data['ssid'] or not info['profile']:
        raise ValueError('Enter the password for this network.')
    profile=info['profile']
    # Verify actual profile identity before retrieving any saved secret.
    if nm('-g','802-11-wireless.ssid','connection','show','uuid',profile)!=data['ssid']:
        raise ValueError('Saved network profile changed. Enter the password again.')
    password=nm('--show-secrets','-g','802-11-wireless-security.psk','connection','show','uuid',profile)
    return {**data,'password':validate_password(password)}

def get_status():
    wifi=wifi_snapshot();wifi['settings']=wifi_ip_settings(wifi.pop('profile',None));wifi['ip']=address(WIFI)
    try:internet=nm('networking','connectivity','check')=='full'
    except Exception:internet=False
    return {'hostname':socket.gethostname(),'showOutput':{'lanOnly':pathlib.Path('/run/ezplayer-show-output.ready').exists(),'interface':'eth0'},'internet':internet,'busy':LOCK.locked(),'error':ERROR,'wifi':wifi,'lan':{'ip':address('eth0'),'settings':lan_settings()},'hotspot':{'active':AP_SERVICE.available(),'state':AP_SERVICE.state,'frequency':AP_SERVICE.freq or 2437,'ssid':config()['ssid']}}

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def request_addresses(self):
        transport=ipaddress.ip_address(self.client_address[0])
        if PROXY_MODE:
            if not transport.is_loopback:raise ValueError('Untrusted proxy.')
            peer=ipaddress.ip_address(self.headers.get('X-EZPlayer-Client-IP',''))
            destination=ipaddress.ip_address(self.headers.get('X-EZPlayer-Server-IP',''))
            if not peer.is_private or not destination.is_private:raise ValueError('Local network required.')
            return str(peer),str(destination)
        return self.client_address[0],self.connection.getsockname()[0]
    def local_access(self):
        raw_peer,destination=self.request_addresses()
        peer=ipaddress.ip_address(raw_peer)
        if peer.is_loopback or (destination==HOTSPOT_IP and peer in ipaddress.ip_network('192.168.4.0/24')):return True
        # Trust local clients reaching the Pi through its current home Wi-Fi IP.
        # In proxy mode the address context comes only from our loopback proxy.
        home_address=address(WIFI)
        try:return peer.is_private and bool(home_address) and destination==str(ipaddress.ip_interface(home_address).ip)
        except ValueError:return False
    def valid_host(self):
        host=self.headers.get('Host','').split(':')[0].lower()
        try:peer,local=self.request_addresses()
        except ValueError:return False
        return host in {local,HOTSPOT_IP,socket.gethostname().lower(),socket.gethostname().lower()+'.local','localhost'} and ipaddress.ip_address(peer).is_private
    def authenticated(self):
        if self.local_access():return True
        try:
            cookie=http.cookies.SimpleCookie(self.headers.get('Cookie',''))
            session=cookie.get('ezplayer_setup')
            if not session:return False
            with AUTH_LOCK:
                entry=SESSIONS.get(session.value)
                if not entry:return False
                fingerprint=hashlib.sha256(config()['password'].encode()).hexdigest()
                return entry['expires']>time.monotonic() and entry['peer']==self.request_addresses()[0] and secrets.compare_digest(entry['fingerprint'],fingerprint)
        except Exception:return False
    def html(self,filename):
        body=(ROOT/'portal'/filename).read_bytes();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");self.end_headers();self.wfile.write(body)
    def login(self,data):
        peer=self.request_addresses()[0];now=time.monotonic()
        with AUTH_LOCK:
            for old_peer in list(LOGIN_ATTEMPTS):
                LOGIN_ATTEMPTS[old_peer]=[t for t in LOGIN_ATTEMPTS[old_peer] if now-t<60]
                if not LOGIN_ATTEMPTS[old_peer]:del LOGIN_ATTEMPTS[old_peer]
            attempts=LOGIN_ATTEMPTS.setdefault(peer,[])
            if len(attempts)>=5:return self.reply(429,{'error':'Wait one minute before trying again.'})
            supplied=data.get('password','')
            if not isinstance(supplied,str) or not secrets.compare_digest(supplied.encode(),config()['password'].encode()):
                attempts.append(now);return self.reply(401,{'error':'Incorrect setup password.'})
            for sid in list(SESSIONS):
                if SESSIONS[sid]['expires']<=now:del SESSIONS[sid]
            if len(SESSIONS)>=64:del SESSIONS[min(SESSIONS,key=lambda sid:SESSIONS[sid]['expires'])]
            sid=secrets.token_urlsafe(32)
            SESSIONS[sid]={'peer':peer,'expires':now+3600,'fingerprint':hashlib.sha256(config()['password'].encode()).hexdigest()}
            LOGIN_ATTEMPTS.pop(peer,None)
        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Set-Cookie','ezplayer_setup='+sid+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600');self.end_headers();self.wfile.write(b'{"ok":true}')
    def reply(self,status,data):
        body=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(body)
    def do_GET(self):
        if not self.valid_host():return self.reply(403,{'error':'Use the player IP address or local hostname.'})
        path=urlsplit(self.path).path
        if not self.authenticated():
            if path.startswith('/api/'):return self.reply(401,{'error':'Sign in with the setup hotspot password.'})
            return self.html('login.html')
        try:
            if path=='/api/network/status':return self.reply(200,{**get_status(),'token':TOKEN})
            if path=='/api/network/scan':
                if not LOCK.acquire(blocking=False):return self.reply(409,{'error':'Another network operation is running.'})
                try:return self.reply(200,{'networks':scan()})
                finally:LOCK.release()
            if path.startswith('/api/'):return self.reply(404,{'error':'Unknown endpoint.'})
            if path not in ('/','/setup','/index.html'):
                self.send_response(302);self.send_header('Location','/setup');self.end_headers();return
            return self.html('index.html')
        except Exception:self.reply(503,{'error':'Network service unavailable.'})
    def do_POST(self):
        if not self.valid_host():return self.reply(403,{'error':'Use the player IP address or local hostname.'})
        is_login=urlsplit(self.path).path=='/api/network/login'
        if not is_login and not self.authenticated():return self.reply(401,{'error':'Sign in with the setup hotspot password.'})
        if not is_login and self.headers.get('X-EZPlayer-Token')!=TOKEN:return self.reply(403,{'error':'Refresh the setup page before making changes.'})
        origin=self.headers.get('Origin');host=self.headers.get('Host','')
        if origin and origin!='http://'+host:return self.reply(403,{'error':'Cross-origin request rejected.'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=4096 or self.headers.get('Content-Type')!='application/json':raise ValueError('Invalid request.')
            data=json.loads(self.rfile.read(length))
            if not isinstance(data,dict):raise ValueError('Invalid request.')
            if is_login:return self.login(data)
            kind=urlsplit(self.path).path.rsplit('/',1)[-1]
            if kind=='wifi-password':
                ssid=validate_ssid(data.get('ssid'))
                return self.reply(200,{'password':resolve_wifi_password({'ssid':ssid,'useSavedPassword':True})['password']})
            if kind=='wifi':data={'ssid':validate_ssid(data.get('ssid')),'password':validate_password(data.get('password'),True),'band':validate_band(data.get('band','auto')),'useSavedPassword':data.get('useSavedPassword') is True}
            elif kind=='hotspot':data={'ssid':validate_ssid(data.get('ssid')),'password':validate_hotspot_password(data.get('password'))}
            elif kind=='lan':data=validate_lan(data)
            elif kind=='wifi-ip':data=validate_wifi_ip(data)
            else:return self.reply(404,{'error':'Unknown endpoint.'})
        except (ValueError,TypeError,KeyError):return self.reply(400,{'error':'Check network name, password and IP settings.'})
        if not LOCK.acquire(blocking=False):return self.reply(409,{'error':'Another network operation is running.'})
        self.reply(202,{'accepted':True});threading.Thread(target=operation,args=(kind,data),daemon=True).start()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--reset-hotspot',action='store_true');args=parser.parse_args()
    if args.reset_hotspot:
        write_config({**config(),'ssid':'EZPLAYER','password':'Ezrgb1234'})
        run('systemctl','restart','ezplayer-network.service');return
    AP_SERVICE.initialize();threading.Thread(target=watcher,daemon=True).start()
    # Home Wi-Fi, hotspot and local Pi access are direct; other LAN access uses login.
    server=http.server.ThreadingHTTPServer(('127.0.0.1' if PROXY_MODE else '0.0.0.0',8081 if PROXY_MODE else 80),Handler)
    try:server.serve_forever()
    finally:server.server_close();AP_SERVICE.close()
if __name__=='__main__':main()
