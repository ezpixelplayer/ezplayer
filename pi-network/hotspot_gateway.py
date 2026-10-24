#!/usr/bin/env python3
"""Restricted TLS passthrough gateway. Never enables general IP forwarding."""
import argparse, ipaddress, json, pathlib, pwd, subprocess, time

DOMAINS = ('ezrgb.com', 'cms.ezrgb.com', 'api.ezplayer.dev', 'ezplayer-player-iad.fly.dev')
AP, WIFI, TABLE, PRIORITY = 'ezsetup0', 'wlan0', '4450', '10460'
DNS = '1.1.1.1'
PRIVATE = '0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4'

def command(*args, check=True, input=None):
    return subprocess.run(args, check=check, input=input, text=True, capture_output=True, timeout=15)

def dns_arguments():
    # Explicit server domains override dnsmasq's captive wildcard. TLS below
    # still admits exact hostnames only, even if a DNS subdomain is resolved.
    return [f'--server=/{domain}/{DNS}@{WIFI}' for domain in DOMAINS] + ['--filter-AAAA', '--filter-rr=HTTPS,SVCB']

def nginx_config():
    targets = '\n'.join(f'        {d} {d}:443;' for d in DOMAINS)
    return f'''load_module /usr/lib/nginx/modules/ngx_stream_module.so;
user ezplayer-gateway;
pid /run/ezplayer-gateway/nginx.pid;
error_log stderr crit;
worker_processes 1;
events {{ worker_connections 256; }}
stream {{
    resolver {DNS} ipv6=off valid=60s;
    resolver_timeout 5s;
    map $ssl_preread_server_name $permitted_target {{
        default unix:/run/ezplayer-gateway/denied;
{targets}
    }}
    server {{
        listen 0.0.0.0:8443;
        ssl_preread on;
        preread_timeout 5s;
        proxy_connect_timeout 5s;
        proxy_timeout 20m;
        proxy_pass $permitted_target;
    }}
}}
'''

def firewall(uid, existing):
    prefix = 'delete table inet ezplayer_gateway\n' if existing else ''
    return prefix + f'''table inet ezplayer_gateway {{
 chain hotspot_redirect {{
  type nat hook prerouting priority dstnat; policy accept;
  iifname "{AP}" ip saddr 192.168.4.0/24 tcp dport 443 redirect to :8443
 }}
 chain input {{
  type filter hook input priority -20; policy accept;
  iifname "{AP}" ip saddr 192.168.4.0/24 tcp dport 8443 accept
  tcp dport 8443 drop
 }}
 chain forward {{
  type filter hook forward priority -20; policy accept;
  iifname "{AP}" drop
  oifname "{AP}" drop
 }}
 chain output {{
  type filter hook output priority -20; policy accept;
  meta skuid {uid} oifname "{AP}" ip daddr 192.168.4.0/24 tcp sport 8443 ct direction reply accept
  meta skuid {uid} meta nfproto != ipv4 drop
  meta skuid {uid} ip daddr {{ {PRIVATE} }} drop
  meta skuid {uid} oifname "{WIFI}" ip daddr {DNS} udp dport 53 accept
  meta skuid {uid} oifname "{WIFI}" tcp dport 443 accept
  meta skuid {uid} drop
 }}
}}
'''

def update_route():
    routes = json.loads(command('ip', '-j', '-4', 'route', 'show', 'table', 'main', 'default', 'dev', WIFI).stdout)
    choices = [r for r in routes if r.get('dev') == WIFI and r.get('gateway') and r.get('type', 'unicast') == 'unicast']
    if not choices:
        command('ip', '-4', 'route', 'del', 'default', 'metric', '10', 'table', TABLE, check=False)
        return
    route = min(choices, key=lambda r: r.get('metric', 0))
    gateway = str(ipaddress.IPv4Address(route['gateway']))
    command('ip', '-4', 'route', 'replace', 'default', 'via', gateway, 'dev', WIFI, 'onlink', 'metric', '10', 'table', TABLE)

def prepare():
    uid = pwd.getpwnam('ezplayer-gateway').pw_uid
    existing = command('nft', 'list', 'table', 'inet', 'ezplayer_gateway', check=False).returncode == 0
    command('nft', '-f', '-', input=firewall(uid, existing))
    command('ip', '-4', 'route', 'replace', 'unreachable', 'default', 'metric', '32767', 'table', TABLE)
    # Responses must return to hotspot clients; only public upstream traffic
    # uses the Wi-Fi-only table. Do not alter the main routing table.
    command('ip', '-4', 'route', 'replace', '192.168.4.0/24', 'dev', AP, 'scope', 'link', 'table', TABLE)
    rules = json.loads(command('ip', '-j', '-4', 'rule', 'show').stdout)
    occupied = [r for r in rules if str(r.get('priority')) == PRIORITY]
    if occupied:
        wanted = {'start': uid, 'end': uid}
        if len(occupied) != 1 or str(occupied[0].get('table')) != TABLE or occupied[0].get('uidrange') not in (f'{uid}-{uid}', wanted):
            raise RuntimeError('Gateway routing priority already occupied')
    else:
        command('ip', '-4', 'rule', 'add', 'priority', PRIORITY, 'uidrange', f'{uid}-{uid}', 'table', TABLE)
    update_route()

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['prepare', 'watch', 'config']); args = parser.parse_args()
    if args.action == 'config':
        print(nginx_config()); return
    if args.action == 'prepare':
        prepare(); return
    while True:
        try: update_route()
        except Exception: print('Gateway Wi-Fi route refresh failed; Ethernet egress remains blocked.', flush=True)
        time.sleep(3)

if __name__ == '__main__': main()
