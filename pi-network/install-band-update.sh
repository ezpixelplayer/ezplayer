#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.'; exit 1; }
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -d /opt/ezplayer-network/portal ]] || { echo 'Install the original network service first.'; exit 1; }
install -m 644 "$source_dir/network_service.py" /opt/ezplayer-network/network_service.py
install -m 644 "$source_dir/portal/login.html" /opt/ezplayer-network/portal/login.html
install -m 644 "$source_dir/portal/index.html" /opt/ezplayer-network/portal/index.html
bash "$source_dir/configure-hostname.sh"
systemctl restart ezplayer-network.service
echo 'Network setup update installed. Open the portal using the player IP or the EZPLAYER hotspot.'
