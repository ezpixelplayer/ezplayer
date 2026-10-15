#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo bash ./install-show-lan-update.sh'; exit 1; }
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -d /opt/ezplayer-network/portal ]] || { echo 'Install the network portal first.'; exit 1; }
ip link show eth0 >/dev/null
# This table and these priorities are reserved exclusively for this component.
if [[ ! -f /opt/ezplayer-network/show_output.py ]]; then
 existing_routes="$(ip -4 route show table 4048 2>/dev/null || true)"
 [[ -z "$existing_routes" ]] || { echo 'Routing table 4048 is already in use. Nothing installed.'; exit 1; }
 if command -v nft >/dev/null && nft list table inet ezplayer_show >/dev/null 2>&1; then echo 'Firewall table ezplayer_show is already in use. Nothing installed.'; exit 1; fi
 if ip -4 rule show | grep -Eq '^1044[89]:'; then echo 'Routing priorities 10448/10449 are already in use. Nothing installed.'; exit 1; fi
fi
apt-get update
apt-get install -y nftables tcpdump
python3 -m py_compile "$source_dir/show_output.py" "$source_dir/network_service.py"
install -m 644 "$source_dir/show_output.py" /opt/ezplayer-network/show_output.py
install -m 644 "$source_dir/ezplayer-show-output.service" /etc/systemd/system/ezplayer-show-output.service
install -d /etc/NetworkManager/dispatcher.d /etc/systemd/system/display-manager.service.d
install -m 755 "$source_dir/90-ezplayer-show-output" /etc/NetworkManager/dispatcher.d/90-ezplayer-show-output
cat > /etc/systemd/system/display-manager.service.d/20-ezplayer-show-output.conf <<'CONF'
[Unit]
Requires=ezplayer-show-output.service
After=ezplayer-show-output.service
CONF
systemctl daemon-reload
systemctl enable ezplayer-show-output.service
systemctl restart ezplayer-show-output.service
# Fail before updating the UI if the guard could not be installed.
test -f /run/ezplayer-show-output.ready
install -m 644 "$source_dir/network_service.py" /opt/ezplayer-network/network_service.py
install -m 644 "$source_dir/portal/index.html" /opt/ezplayer-network/portal/index.html
install -m 644 "$source_dir/portal/login.html" /opt/ezplayer-network/portal/login.html
systemctl restart ezplayer-network.service
echo 'Installed: standard DDP (UDP 4048) and sACN (UDP 5568) use eth0 only.'
echo 'Restart EZPlayer before testing so existing UDP sockets use the new routing.'
echo 'The logo is installed on setup and setup login. Reopen /setup.'
echo 'Verify output with a real controller and with the Ethernet cable unplugged before building an image.'
