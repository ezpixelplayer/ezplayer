#!/usr/bin/env python3
"""Dedicated DDP/sACN routing and egress guard for the Pi appliance."""
import argparse,fcntl,json,pathlib,subprocess,sys
INTERFACE='eth0'
PORTS=(4048,5568)
TABLE=4048
PRIORITY=10448
NFT_TABLE='ezplayer_show'
READY=pathlib.Path('/run/ezplayer-show-output.ready')

def command(*args,check=True,input=None):
    return subprocess.run(args,input=input,text=True,capture_output=True,check=check)

def firewall(existing):
    prefix=f'delete table inet {NFT_TABLE}\n' if existing else ''
    return prefix+f'''table inet {NFT_TABLE} {{
 chain output {{
  type filter hook output priority -10; policy accept;
  udp dport {{ {', '.join(map(str,PORTS))} }} oifname != "{INTERFACE}" counter drop comment "EZPlayer show output must use Ethernet"
 }}
}}
'''

def matches_port(value,port):
    if isinstance(value,dict):return str(value.get('start'))==str(port) and str(value.get('end'))==str(port)
    return str(value) in (str(port),f'{port}-{port}')

def apply():
    READY.unlink(missing_ok=True)
    # Install the no-Wi-Fi guard first, before making any routing changes.
    exists=command('nft','list','table','inet',NFT_TABLE,check=False).returncode==0
    command('nft','-f','-',input=firewall(exists))
    # Only this dedicated routing table is owned by EZPlayer. No main/default
    # routes, Wi-Fi settings, or other firewall tables are changed.
    command('ip','-4','route','replace','unreachable','default','metric','32767','table',str(TABLE))
    links=json.loads(command('ip','-j','link','show','dev',INTERFACE).stdout)
    up=bool(links and 'UP' in links[0].get('flags',[]) and links[0].get('operstate')=='UP')
    if up:
        command('ip','-4','route','replace','default','dev',INTERFACE,'scope','link','metric','10','table',str(TABLE))
    else:
        command('ip','-4','route','del','default','dev',INTERFACE,'metric','10','table',str(TABLE),check=False)
    # Deterministic owned priorities: add only when absent, never delete a
    # foreign rule. A mismatching rule at a reserved priority stops installation.
    rules=json.loads(command('ip','-j','-4','rule','show').stdout)
    for offset,port in enumerate(PORTS):
        priority=PRIORITY+offset
        found=[r for r in rules if r.get('priority')==priority]
        if found:
            if len(found)!=1 or str(found[0].get('table'))!=str(TABLE) or not matches_port(found[0].get('dport'),port) or str(found[0].get('ipproto')) not in ('udp','17'):
                raise RuntimeError(f'Routing priority {priority} is already in use.')
        else:
            command('ip','-4','rule','add','priority',str(priority),'ipproto','udp','dport',str(port),'table',str(TABLE))
    command('ip','-4','route','flush','cache')
    READY.write_text(json.dumps({'interface':INTERFACE,'ports':PORTS}))

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['apply']);parser.parse_args()
    with open('/run/ezplayer-show-output.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX);apply()
if __name__=='__main__':
    try:main()
    except Exception as exc:
        print(f'Show output restriction could not be applied: {exc}',file=sys.stderr);sys.exit(1)
