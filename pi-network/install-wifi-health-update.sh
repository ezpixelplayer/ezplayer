#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.'; exit 1; }
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -f /opt/ezplayer-network/network_service.py ]] || { echo 'Install the portal first.'; exit 1; }
if ! command -v hostapd_cli >/dev/null; then apt-get update; apt-get install -y hostapd; fi
python3 -m py_compile "$source_dir/network_service.py"
backup="/var/lib/ezplayer-network/wifi-health-backup-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup"
cp -p /opt/ezplayer-network/network_service.py "$backup/network_service.py"
cp -p /opt/ezplayer-network/portal/index.html "$backup/index.html"
cp -p /opt/ezplayer-network/portal/login.html "$backup/login.html"
rollback() {
 trap - ERR
 cp -p "$backup/network_service.py" /opt/ezplayer-network/network_service.py
 cp -p "$backup/index.html" /opt/ezplayer-network/portal/index.html
 cp -p "$backup/login.html" /opt/ezplayer-network/portal/login.html
 systemctl restart ezplayer-network.service || true
 echo "Hotspot did not initialize. Previous version restored. Backup: $backup"
 exit 1
}
trap rollback ERR
install -m 644 "$source_dir/network_service.py" /opt/ezplayer-network/network_service.py
install -m 644 "$source_dir/portal/index.html" /opt/ezplayer-network/portal/index.html
install -m 644 "$source_dir/portal/login.html" /opt/ezplayer-network/portal/login.html
systemctl restart ezplayer-network.service
ready=0
for attempt in {1..30}; do
 if hostapd_cli -p /run/ezplayer-network/hostapd -i ezsetup0 status 2>/dev/null | grep -Eq '^state=(ENABLED|DFS)$'; then ready=1; break; fi
 sleep 1
done
[[ $ready -eq 1 ]]
trap - ERR
echo 'Hotspot health update installed. Saved Wi-Fi band and network settings were retained.'
echo 'Switch Home Wi-Fi to 5 GHz to test. DFS state means regulatory checks are still in progress.'
echo "Backup: $backup"
