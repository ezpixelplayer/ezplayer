#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.'; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
target=/etc/nginx/conf.d/ezplayer-web.conf
[[ -f "$target" ]] || { echo 'EZPlayer nginx configuration not found'; exit 1; }
backup=$(mktemp /etc/nginx/conf.d/ezplayer-web.conf.backup-preview.XXXXXX)
cp -p "$target" "$backup"
rollback() {
    trap - ERR
    cp -p "$backup" "$target"
    nginx -t && systemctl reload nginx || true
    echo 'Preview compression update failed; previous web configuration restored.'
    exit 1
}
trap rollback ERR
install -m 644 "$source_dir/ezplayer-web.conf" "$target"
nginx -t
systemctl reload nginx
trap - ERR
echo 'Preview JSON compression installed. Nginx reloaded; the player was not restarted.'
echo 'Refresh the preview on the laptop/phone, then repeat the compressed download timings.'
