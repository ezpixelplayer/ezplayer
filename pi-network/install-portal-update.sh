#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.'; exit 1; }
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -d /opt/ezplayer-network/portal ]] || { echo 'Install the network portal first.'; exit 1; }
python3 -m py_compile "$source_dir/network_service.py"
install -m 644 "$source_dir/network_service.py" /opt/ezplayer-network/network_service.py
install -m 644 "$source_dir/portal/index.html" /opt/ezplayer-network/portal/index.html
systemctl restart ezplayer-network.service
echo 'Portal updated. Close and reopen /setup.'
