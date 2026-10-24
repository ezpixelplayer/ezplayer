#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo bash ./install-web-access.sh'; exit 1; }
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -f /opt/ezplayer-network/network_service.py ]] || { echo 'Install the network portal first.'; exit 1; }
for file in network_service.py portal/index.html ezplayer-web.conf; do
 [[ -f "$source_dir/$file" ]] || { echo "Missing update file: $file"; exit 1; }
done
if [[ ! -f /etc/systemd/system/ezplayer-network.service.d/20-web-proxy.conf ]] && ss -ltnH 'sport = :8081' | grep -q .; then
 echo 'Port 8081 is occupied. Resolve that conflict before installing.'; exit 1
fi
python3 -m py_compile "$source_dir/network_service.py"
if [[ ! -f /etc/nginx/conf.d/ezplayer-web.conf ]]; then
 if systemctl is-active --quiet nginx; then
  echo 'An existing nginx service needs review before installing EZPlayer routing.'; exit 1
 fi
 if [[ -d /etc/nginx ]]; then
  other_sites="$(find /etc/nginx/sites-enabled /etc/nginx/conf.d -maxdepth 1 -type f -o -type l 2>/dev/null || true)"
  while IFS= read -r site; do
   [[ -z "$site" || "$site" == /etc/nginx/sites-enabled/default ]] || { echo "Existing web configuration needs review: $site"; exit 1; }
  done <<< "$other_sites"
 fi
fi
apt-get update
apt-get install -y nginx curl
backup_dir="/var/lib/ezplayer-network/web-backup-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup_dir" /etc/nginx/conf.d /etc/systemd/system/ezplayer-network.service.d
cp -a /opt/ezplayer-network/network_service.py "$backup_dir/network_service.py"
cp -a /opt/ezplayer-network/portal/index.html "$backup_dir/index.html"
for path in /etc/nginx/conf.d/ezplayer-web.conf /etc/systemd/system/ezplayer-network.service.d/20-web-proxy.conf /etc/nginx/sites-enabled/default; do
 if [[ -e "$path" || -L "$path" ]]; then cp -a "$path" "$backup_dir/$(basename "$path")"; fi
done
rollback() {
 trap - ERR
 systemctl stop nginx || true
 cp -a "$backup_dir/network_service.py" /opt/ezplayer-network/network_service.py
 cp -a "$backup_dir/index.html" /opt/ezplayer-network/portal/index.html
 for path in /etc/nginx/conf.d/ezplayer-web.conf /etc/systemd/system/ezplayer-network.service.d/20-web-proxy.conf /etc/nginx/sites-enabled/default; do
  rm -f "$path"
  if [[ -e "$backup_dir/$(basename "$path")" || -L "$backup_dir/$(basename "$path")" ]]; then cp -a "$backup_dir/$(basename "$path")" "$path"; fi
 done
 systemctl daemon-reload
 systemctl restart ezplayer-network.service || true
 if [[ -f "$backup_dir/ezplayer-web.conf" ]]; then systemctl restart nginx || true; else systemctl disable nginx || true; fi
 echo "Installation failed. Previous portal restored. Backup: $backup_dir"
 exit 1
}
trap rollback ERR
install -m 644 "$source_dir/ezplayer-web.conf" /etc/nginx/conf.d/ezplayer-web.conf
rm -f /etc/nginx/sites-enabled/default
cat > /etc/systemd/system/ezplayer-network.service.d/20-web-proxy.conf <<'CONF'
[Service]
Environment=EZPLAYER_PROXY_MODE=1
CONF
nginx -t
install -m 644 "$source_dir/network_service.py" /opt/ezplayer-network/network_service.py
install -m 644 "$source_dir/portal/index.html" /opt/ezplayer-network/portal/index.html
systemctl daemon-reload
systemctl restart ezplayer-network.service
systemctl enable nginx
systemctl restart nginx
systemctl is-active --quiet ezplayer-network.service
systemctl is-active --quiet nginx
ready=0
for attempt in {1..30}; do
 if curl --fail --silent http://127.0.0.1/setup >/dev/null; then ready=1; break; fi
 sleep 1
done
[[ $ready -eq 1 ]]
trap - ERR
echo 'Installed. The base IP opens EZPlayer; /setup opens Network Setup.'
echo 'Existing :3000 access remains available. Hostname resolution is unchanged.'
echo "Backup: $backup_dir"
