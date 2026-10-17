#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo bash ./install-pi.sh US'; exit 1; }
country="${1:-}"
[[ "$country" =~ ^[A-Z]{2}$ ]] || { echo 'Supply your two-letter Wi-Fi country code, such as US.'; exit 1; }
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v nmcli >/dev/null || { echo 'NetworkManager is required.'; exit 1; }
systemctl is-active --quiet NetworkManager || { echo 'NetworkManager must be running.'; exit 1; }
ip link show wlan0 >/dev/null
if iw dev | grep 'type AP' >/dev/null 2>&1 && ! ip link show ezsetup0 >/dev/null 2>&1; then
 echo 'Disable the existing EZPlayer tethering/hotspot before installing this service.'
 exit 1
fi
if ! systemctl is-active --quiet ezplayer-network.service && ss -ltn | awk '{print $4}' | grep -Eq '(^|:)80$'; then
 echo 'Port 80 is occupied. Stop the conflicting HTTP service first.'; exit 1
fi
if ip -4 route show | grep '192.168.4.' | grep -v 'dev ezsetup0' >/dev/null; then
 echo '192.168.4.0/24 is already in use. Resolve that subnet conflict first.'; exit 1
fi
systemctl stop ezplayer-network.service 2>/dev/null || true
apt-get update
apt-get install -y hostapd dnsmasq-base iw python3-gpiozero python3-lgpio avahi-daemon
install -d -m 755 /opt/ezplayer-network/portal
install -d -m 700 /var/lib/ezplayer-network
install -m 644 "$source_dir/network_service.py" "$source_dir/reset_button.py" /opt/ezplayer-network/
install -m 644 "$source_dir/portal/login.html" /opt/ezplayer-network/portal/login.html
install -m 644 "$source_dir/portal/index.html" /opt/ezplayer-network/portal/
if [[ ! -f /var/lib/ezplayer-network/hotspot.json ]]; then
 COUNTRY_CODE="$country" python3 - <<'PY'
import json,os
p='/var/lib/ezplayer-network/hotspot.json'
with open(p,'w') as f:
 os.chmod(p,0o600)
 json.dump({'ssid':'EZPLAYER','password':'Ezrgb1234','country':os.environ['COUNTRY_CODE']},f)
PY
fi
install -d /etc/NetworkManager/conf.d
cat > /etc/NetworkManager/conf.d/90-ezplayer-setup.conf <<'EOF'
[keyfile]
unmanaged-devices=interface-name:ezsetup0
EOF
nmcli general reload
install -m 644 "$source_dir/ezplayer-network.service" "$source_dir/ezplayer-reset-button.service" /etc/systemd/system/
systemctl daemon-reload
bash "$source_dir/configure-hostname.sh"
systemctl enable --now ezplayer-network.service
bash "$source_dir/install-web-access.sh"
bash "$source_dir/install-show-lan-update.sh"
sleep 2
systemctl is-active --quiet ezplayer-network.service || { echo 'Service failed. Run: sudo journalctl -u ezplayer-network -n 40'; exit 1; }
echo 'Installed. Join EZPLAYER with Ezrgb1234, then open http://192.168.4.1.'
echo 'The optional GPIO reset button service is installed but not enabled.'
