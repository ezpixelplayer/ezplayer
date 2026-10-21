#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo'; exit 1; }
player_user=${1:-${SUDO_USER:-ezplayer}}
[[ $player_user =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 1
player_uid=$(id -u "$player_user")
[[ $player_uid -ne 0 ]] || { echo 'Select the unprivileged player user'; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
python3 -m py_compile "$source_dir/prepare_player_start.py"
as_player() {
    runuser -u "$player_user" -- env XDG_RUNTIME_DIR="/run/user/$player_uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$player_uid/bus" "$@"
}
systemctl start "user@$player_uid.service"
[[ -S /run/user/$player_uid/bus ]] || { echo 'Player user manager is not running'; exit 1; }
as_player systemctl --user stop ezplayer-player.service
install -d -m 755 /usr/local/lib/ezplayer-pi /etc/systemd/user/ezplayer-player.service.d
if [[ -e /usr/local/lib/ezplayer-pi/prepare_player_start.py ]]; then
    cp -a /usr/local/lib/ezplayer-pi/prepare_player_start.py "/usr/local/lib/ezplayer-pi/prepare_player_start.py.backup.$(date +%s)"
fi
install -m 644 "$source_dir/prepare_player_start.py" /usr/local/lib/ezplayer-pi/prepare_player_start.py
cat > /etc/systemd/user/ezplayer-player.service.d/30-lock-recovery.conf <<'CONF'
[Service]
ExecStartPre=/usr/bin/python3 /usr/local/lib/ezplayer-pi/prepare_player_start.py
CONF
as_player systemctl --user daemon-reload
as_player systemctl --user start ezplayer-player.service
for attempt in {1..15}; do
    if curl -fsS --max-time 2 http://127.0.0.1:3000/ -o /dev/null; then
        echo 'Startup lock preflight installed; player web server is responding.'
        echo 'Next: test a clean shutdown and power cycle with HDMI disconnected.'
        exit 0
    fi
    sleep 2
done
echo 'Startup check installed, but player readiness was not confirmed. Capture the logs before rebooting.'
journalctl -b _SYSTEMD_USER_UNIT=ezplayer-player.service -n 40 --no-pager
exit 1
