#!/usr/bin/env bash
# Offline rootfs installation only. Do not access a build host's Wi-Fi hardware.
set -euo pipefail
[[ $EUID -eq 0 && ${EZPLAYER_IMAGE_BUILD:-0} == 1 ]] || { echo 'Image build mode required'; exit 1; }
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
country=${1:?country required}
player_user=${2:?player username required}
[[ $country =~ ^[A-Z]{2}$ && $player_user =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 1
apt-get update
apt-get install -y network-manager hostapd dnsmasq-base iw rfkill python3-gpiozero python3-lgpio avahi-daemon nginx libnginx-mod-stream curl nftables tcpdump
install -d -m 755 /opt/ezplayer-network/portal /usr/local/lib/ezplayer-pi
install -d -m 700 /var/lib/ezplayer-network
install -d -m 755 /etc/wireplumber/wireplumber.conf.d
install -m 644 "$source_dir/90-ezplayer-volume.conf" /etc/wireplumber/wireplumber.conf.d/90-ezplayer-volume.conf
install -m 644 "$source_dir/network_service.py" "$source_dir/show_output.py" "$source_dir/reset_button.py" /opt/ezplayer-network/
id ezplayer-gateway >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin ezplayer-gateway
install -m 644 "$source_dir/hotspot_gateway.py" /opt/ezplayer-network/hotspot_gateway.py
python3 "$source_dir/hotspot_gateway.py" config > /etc/ezplayer-gateway.conf
chmod 644 /etc/ezplayer-gateway.conf
install -m 644 "$source_dir/ezplayer-gateway.service" "$source_dir/ezplayer-gateway-route.service" /etc/systemd/system/
install -m 644 "$source_dir/portal/index.html" "$source_dir/portal/login.html" /opt/ezplayer-network/portal/
install -m 755 "$source_dir/image-firstboot.sh" /usr/local/lib/ezplayer-pi/image-firstboot.sh
COUNTRY_CODE="$country" python3 - <<'PY'
import json,os
p='/var/lib/ezplayer-network/hotspot.json'
with open(p,'x') as f:
 os.chmod(p,0o600);json.dump({'ssid':'EZPLAYER','password':'Ezrgb1234','country':os.environ['COUNTRY_CODE']},f)
PY
printf '%s\n' "$player_user" > /etc/ezplayer-image-user
install -d /etc/NetworkManager/conf.d /etc/NetworkManager/dispatcher.d /etc/nginx/conf.d
cat > /etc/NetworkManager/conf.d/90-ezplayer-setup.conf <<'CONF'
[keyfile]
unmanaged-devices=interface-name:ezsetup0
[connection]
wifi.powersave=2
CONF
install -m 755 "$source_dir/90-ezplayer-show-output" /etc/NetworkManager/dispatcher.d/90-ezplayer-show-output
install -m 644 "$source_dir/ezplayer-network.service" "$source_dir/ezplayer-show-output.service" "$source_dir/ezplayer-reset-button.service" "$source_dir/ezplayer-image-firstboot.service" /etc/systemd/system/
install -d /etc/systemd/system/ezplayer-network.service.d
cat > /etc/systemd/system/ezplayer-network.service.d/10-image-firstboot.conf <<'CONF'
[Unit]
Wants=ezplayer-image-firstboot.service
After=ezplayer-image-firstboot.service
CONF
install -d /etc/systemd/system/ezplayer-show-output.service.d
cat > /etc/systemd/system/ezplayer-show-output.service.d/10-image-firstboot.conf <<'CONF'
[Unit]
Requires=ezplayer-image-firstboot.service
After=ezplayer-image-firstboot.service
CONF
cat > /etc/systemd/system/ezplayer-network.service.d/20-web-proxy.conf <<'CONF'
[Service]
Environment=EZPLAYER_PROXY_MODE=1
CONF
install -d /etc/systemd/user/ezplayer-player.service.d
cat > /etc/systemd/user/ezplayer-player.service.d/20-show-output.conf <<'CONF'
[Service]
Environment=EZPLAYER_WAIT_FOR_SHOW_OUTPUT=1
CONF
install -m 644 "$source_dir/ezplayer-web.conf" /etc/nginx/conf.d/ezplayer-web.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl disable hostapd ezplayer-reset-button.service ezplayer-setup-portal.service
systemctl enable NetworkManager.service avahi-daemon.service nginx.service ezplayer-network.service ezplayer-show-output.service ezplayer-image-firstboot.service
systemctl enable ezplayer-gateway.service ezplayer-gateway-route.service
# These must not be generated or copied into the distributable rootfs.
test ! -e /var/lib/ezplayer-network/image-initialized
test ! -e /var/lib/ezplayer-network/wifi-display.json
test -z "$(find /etc/NetworkManager/system-connections -maxdepth 1 -type f -print -quit)"
