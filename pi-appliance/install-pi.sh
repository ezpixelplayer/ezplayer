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
apt-get update
apt-get install -y network-manager python3-dbus pipewire pipewire-pulse wireplumber "$package_path"
getent group ezplayer-system >/dev/null || groupadd --system ezplayer-system
usermod -a -G ezplayer-system "$player_user"
install -D -o root -g root -m 0755 "$script_dir/pi_service.py" /usr/local/lib/ezplayer-pi/pi_service.py
install -D -o root -g root -m 0644 "$script_dir/ezplayer-pi.service" /etc/systemd/system/ezplayer-pi.service
install -D -o root -g root -m 0644 "$script_dir/ezplayer-desktop.service" /etc/systemd/user/ezplayer-desktop.service
install -D -o root -g root -m 0755 "$script_dir/start-desktop.sh" /usr/local/bin/ezplayer-pi-start
install -D -o root -g root -m 0644 "$script_dir/ezplayer-autostart.desktop" /etc/xdg/autostart/ezplayer-pi.desktop
mkdir -p /etc/lightdm/lightdm.conf.d
cat > /etc/lightdm/lightdm.conf.d/90-ezplayer-pi.conf <<EOF
[Seat:*]
autologin-user=$player_user
autologin-user-timeout=0
EOF
if [[ -x /usr/bin/raspi-config ]]; then
    raspi-config nonint do_wifi_country "$wifi_country"
fi
systemctl enable NetworkManager.service ezplayer-pi.service
systemctl restart ezplayer-pi.service
printf '\nInstalled. Reboot to load group membership and start EZPlayer.\n'
printf 'Use Settings > Pi Network to join Wi-Fi. No account or Wi-Fi password is baked into this package.\n'
