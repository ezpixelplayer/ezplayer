#!/bin/bash
set -euo pipefail
# Run on a Pi with Raspberry Pi OS Lite 64-bit and the modified arm64 .deb.
if [[ $EUID -ne 0 ]]; then
    echo 'Run: sudo ./install-pi.sh /path/to/modified-arm64.deb your-player-username' >&2
    exit 1
fi
package_path=$(realpath -- "${1:?Supply the rebuilt arm64 .deb}")
image_build=${EZPLAYER_IMAGE_BUILD:-0}
[[ $image_build == 0 || $image_build == 1 ]] || { echo "Invalid image build flag"; exit 1; }
player_user=${2:?Supply the existing player username}
[[ $(uname -m) == aarch64 ]] || { echo '64-bit ARM OS required'; exit 1; }
[[ $player_user =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo 'Invalid username'; exit 1; }
[[ $(id -u "$player_user") -ne 0 ]] || { echo 'Use a normal unprivileged user'; exit 1; }
player_home=$(getent passwd "$player_user" | cut -d: -f6)
player_group=$(id -gn "$player_user")
[[ -f $package_path ]] || exit 1
[[ $(dpkg-deb -f "$package_path" Architecture) == arm64 ]] || { echo 'arm64 package required'; exit 1; }
wifi_country=${3:-US}
[[ $wifi_country =~ ^[A-Z]{2}$ ]] || { echo 'Supply a two-letter Wi-Fi country'; exit 1; }
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
for source in pi_service.py pi_hotspot.py pi_clock.py initialize_show.py prepare_player_start.py setup_portal.py ezplayer-pi.service ezplayer-setup-portal.service ezplayer-player.service; do
    [[ -s "$script_dir/$source" ]] || { echo "Missing or empty integration file: $source" >&2; exit 1; }
done
apt-get update
apt-get install -y network-manager dnsmasq-base dbus-user-session python3-dbus python3-aiohttp pipewire pipewire-pulse wireplumber "$package_path"
# Initialize show storage as its owner; preserve an already selected show folder.
if [[ $image_build == 0 ]]; then
    /usr/sbin/runuser -u "$player_user" -- /usr/bin/python3 "$script_dir/initialize_show.py"
else
    # A player identity must be created independently on each physical Pi.
    # pi-gen and package post-install hooks run as root. Normalize the private
    # app directory before first boot so the unprivileged player can seed it.
    install -d -o "$player_user" -g "$player_group" -m 0700 "$player_home/.config" "$player_home/.config/ezplayer-ui-electron"
    chown -R "$player_user:$player_group" "$player_home/.config/ezplayer-ui-electron"
    install -d -o "$player_user" -g "$player_group" "$player_home/EZPlayer/Show"
fi
getent group ezplayer-system >/dev/null || groupadd --system ezplayer-system
usermod -a -G ezplayer-system "$player_user"
id ezplayer-portal >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin --gid ezplayer-system ezplayer-portal
id -u "$player_user" > /etc/ezplayer-pi-player-uid
systemctl unmask ezplayer-pi.service ezplayer-setup-portal.service
install -D -o root -g root -m 0644 "$script_dir/initialize_show.py" /usr/local/lib/ezplayer-pi/initialize_show.py
install -D -o root -g root -m 0644 "$script_dir/prepare_player_start.py" /usr/local/lib/ezplayer-pi/prepare_player_start.py
install -D -o root -g root -m 0755 "$script_dir/pi_service.py" /usr/local/lib/ezplayer-pi/pi_service.py
install -D -o root -g root -m 0644 "$script_dir/pi_hotspot.py" /usr/local/lib/ezplayer-pi/pi_hotspot.py
install -D -o root -g root -m 0644 "$script_dir/pi_clock.py" /usr/local/lib/ezplayer-pi/pi_clock.py
install -D -o root -g root -m 0755 "$script_dir/setup_portal.py" /usr/local/lib/ezplayer-pi/setup_portal.py
install -D -o root -g root -m 0644 "$script_dir/ezplayer-setup-portal.service" /etc/systemd/system/ezplayer-setup-portal.service
install -D -o root -g root -m 0644 "$script_dir/ezplayer-pi.service" /etc/systemd/system/ezplayer-pi.service
install -D -o root -g root -m 0644 "$script_dir/ezplayer-player.service" /etc/systemd/user/ezplayer-player.service
for target in /usr/local/lib/ezplayer-pi/{pi_service.py,pi_hotspot.py,pi_clock.py,setup_portal.py} /etc/systemd/system/{ezplayer-pi.service,ezplayer-setup-portal.service} /etc/systemd/user/ezplayer-player.service; do
    [[ -s "$target" ]] || { echo "Integration file did not install correctly: $target" >&2; exit 1; }
done
# Remove the former desktop-session launcher when upgrading an existing card.
rm -f /etc/systemd/user/ezplayer-desktop.service /etc/xdg/autostart/ezplayer-pi.desktop /usr/local/bin/ezplayer-pi-start /etc/lightdm/lightdm.conf.d/90-ezplayer-pi.conf
# A lingering per-user systemd manager starts the player at boot without a
# login session. PipeWire and WirePlumber run in the same user manager, which
# gives the hidden audio renderer local HDMI/USB output on Raspberry Pi OS Lite.
install -d -o "$player_user" -g "$player_group" -m 0755 "$player_home/.config/systemd/user/default.target.wants"
ln -sfn /etc/systemd/user/ezplayer-player.service "$player_home/.config/systemd/user/default.target.wants/ezplayer-player.service"
chown -h "$player_user:$player_group" "$player_home/.config/systemd/user/default.target.wants/ezplayer-player.service"
install -d -m 0755 /var/lib/systemd/linger
install -o root -g root -m 0644 /dev/null "/var/lib/systemd/linger/$player_user"
if [[ $image_build == 0 && -x /usr/bin/raspi-config ]]; then
    raspi-config nonint do_wifi_country "$wifi_country"
fi
# dnsmasq is spawned by NM only on shared/hotspot interfaces.
mkdir -p /etc/NetworkManager/dnsmasq-shared.d
printf 'address=/#/192.168.4.1\n' > /etc/NetworkManager/dnsmasq-shared.d/ezplayer-setup.conf
systemctl daemon-reload
# The standalone captive portal owns port 80; keep the legacy portal dormant.
if [[ $image_build == 0 ]]; then
    systemctl disable --now ezplayer-setup-portal.service
else
    systemctl disable ezplayer-setup-portal.service
fi
systemctl enable NetworkManager.service ezplayer-pi.service
if [[ $image_build == 0 ]]; then systemctl restart ezplayer-pi.service; fi

printf '\nInstalled. Reboot to load group membership and start the headless EZPlayer service.\n'
printf 'Use the standalone setup hotspot portal to join Wi-Fi. No account or Wi-Fi password is baked into this package.\n'
