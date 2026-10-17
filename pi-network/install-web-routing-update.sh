#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.'; exit 1; }
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
target=/etc/nginx/conf.d/ezplayer-web.conf
[[ -f "$target" ]] || { echo 'Install EZPlayer Web Access first.'; exit 1; }
backup="$(mktemp /etc/nginx/conf.d/ezplayer-web.conf.backup.XXXXXX)"
cp -p "$target" "$backup"
rollback() {
 trap - ERR
 cp -p "$backup" "$target"
 nginx -t && systemctl reload nginx || true
 echo 'Routing update failed; previous configuration restored.'
 exit 1
}
trap rollback ERR
install -m 644 "$source_dir/ezplayer-web.conf" "$target"
nginx -t
systemctl reload nginx
trap - ERR
echo 'Updated: 192.168.4.1 opens setup; home-network base addresses open the player.'
echo 'The hotspot and player were not restarted.'
