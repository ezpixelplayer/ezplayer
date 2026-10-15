#!/usr/bin/env bash
set -euo pipefail
[[ ! -f /var/lib/ezplayer-network/image-initialized ]] || exit 0
country=$(python3 -c 'import json; print(json.load(open("/var/lib/ezplayer-network/hotspot.json"))["country"])')
iw reg set "$country"
rfkill unblock wifi
cd /opt/ezplayer-network
python3 - <<'PY'
import network_service as s
s.apply_lan(s.validate_lan({'mode':'ezrgb'}))
PY
player_user=$(cat /etc/ezplayer-image-user)
/usr/sbin/runuser -u "$player_user" -- /usr/bin/python3 /usr/local/lib/ezplayer-pi/initialize_show.py
install -m 600 /dev/null /var/lib/ezplayer-network/image-initialized
