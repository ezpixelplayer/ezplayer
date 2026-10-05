#!/bin/bash
set -euo pipefail
# Run on a Pi with Raspberry Pi OS 64-bit Desktop and the MODIFIED arm64 .deb.
if [[ $EUID -ne 0 ]]; then
    echo 'Run: sudo ./install-pi.sh /path/to/modified-arm64.deb your-desktop-username' >&2
    exit 1
fi
package_path=$(realpath -- "${1:?Supply the rebuilt arm64 .deb}")
player_user=${2:?Supply the existing desktop username}
[[ $(uname -m) == aarch64 ]] || { echo '64-bit ARM OS required'; exit 1; }
[[ $player_user =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo 'Invalid username'; exit 1; }
[[ $(id -u "$player_user") -ne 0 ]] || { echo 'Use a normal desktop user'; exit 1; }
[[ -f $package_path ]] || exit 1
[[ $(dpkg-deb -f "$package_path" Architecture) == arm64 ]] || { echo 'arm64 package required'; exit 1; }
[[ -x /usr/sbin/lightdm ]] || { echo 'Raspberry Pi OS Desktop with LightDM required'; exit 1; }
wifi_country=${3:-US}
[[ $wifi_country =~ ^[A-Z]{2}$ ]] || { echo 'Supply a two-letter Wi-Fi country'; exit 1; }
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
for source in pi_service.py pi_hotspot.py setup_portal.py ezplayer-pi.service ezplayer-setup-portal.service ezplayer-desktop.service start-desktop.sh ezplayer-autostart.desktop; do
    [[ -s "$script_dir/$source" ]] || { echo "Missing or empty integration file: $source" >&2; exit 1; }
done
apt-get update
apt-get install -y network-manager dnsmasq-base python3-dbus python3-aiohttp pipewire pipewire-pulse wireplumber "$package_path"
getent group ezplayer-system >/dev/null || groupadd --system ezplayer-system
usermod -a -G ezplayer-system "$player_user"
id ezplayer-portal >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin --gid ezplayer-system ezplayer-portal
id -u "$player_user" > /etc/ezplayer-pi-player-uid
systemctl unmask ezplayer-pi.service ezplayer-setup-portal.service
systemctl --global unmask ezplayer-desktop.service
install -D -o root -g root -m 0755 "$script_dir/pi_service.py" /usr/local/lib/ezplayer-pi/pi_service.py
install -D -o root -g root -m 0644 "$script_dir/pi_hotspot.py" /usr/local/lib/ezplayer-pi/pi_hotspot.py
install -D -o root -g root -m 0755 "$script_dir/setup_portal.py" /usr/local/lib/ezplayer-pi/setup_portal.py
install -D -o root -g root -m 0644 "$script_dir/ezplayer-setup-portal.service" /etc/systemd/system/ezplayer-setup-portal.service
install -D -o root -g root -m 0644 "$script_dir/ezplayer-pi.service" /etc/systemd/system/ezplayer-pi.service
install -D -o root -g root -m 0644 "$script_dir/ezplayer-desktop.service" /etc/systemd/user/ezplayer-desktop.service
install -D -o root -g root -m 0755 "$script_dir/start-desktop.sh" /usr/local/bin/ezplayer-pi-start
install -D -o root -g root -m 0644 "$script_dir/ezplayer-autostart.desktop" /etc/xdg/autostart/ezplayer-pi.desktop
for target in /usr/local/lib/ezplayer-pi/{pi_service.py,pi_hotspot.py,setup_portal.py} /etc/systemd/system/{ezplayer-pi.service,ezplayer-setup-portal.service} /etc/systemd/user/ezplayer-desktop.service /usr/local/bin/ezplayer-pi-start /etc/xdg/autostart/ezplayer-pi.desktop; do
    [[ -s "$target" ]] || { echo "Integration file did not install correctly: $target" >&2; exit 1; }
done
mkdir -p /etc/lightdm/lightdm.conf.d
cat > /etc/lightdm/lightdm.conf.d/90-ezplayer-pi.conf <<EOF
[Seat:*]
autologin-user=$player_user
autologin-user-timeout=0
EOF
if [[ -x /usr/bin/raspi-config ]]; then
    raspi-config nonint do_wifi_country "$wifi_country"
fi
# dnsmasq is spawned by NM only on shared/hotspot interfaces.
mkdir -p /etc/NetworkManager/dnsmasq-shared.d
printf 'address=/#/192.168.4.1\n' > /etc/NetworkManager/dnsmasq-shared.d/ezplayer-setup.conf
systemctl daemon-reload
systemctl enable NetworkManager.service ezplayer-pi.service ezplayer-setup-portal.service
systemctl restart ezplayer-pi.service
systemctl restart ezplayer-setup-portal.service
printf '\nInstalled. Reboot to load group membership and start EZPlayer.\n'
printf 'Use Settings > Pi Network to join Wi-Fi. No account or Wi-Fi password is baked into this package.\n'
