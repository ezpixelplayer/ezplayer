#!/usr/bin/env bash
set -euo pipefail
hostnamectl set-hostname EZPlayer
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/hosts');lines=p.read_text().splitlines();found=False;out=[]
for line in lines:
 parts=line.split()
 if parts and parts[0]=='127.0.1.1':
  if not found:out.append('127.0.1.1\tEZPlayer ezplayer');found=True
 else:out.append(line)
if not found:out.append('127.0.1.1\tEZPlayer ezplayer')
p.write_text('\n'.join(out)+'\n')
PY
# Send the chosen name at the next DHCP request; do not disrupt active links.
while IFS= read -r profile_uuid; do
 [[ -n "$profile_uuid" ]] || continue
 profile_type="$(nmcli -g connection.type connection show uuid "$profile_uuid")"
 if [[ "$profile_type" == '802-11-wireless' || "$profile_type" == '802-3-ethernet' ]]; then
  nmcli connection modify uuid "$profile_uuid" ipv4.dhcp-hostname EZPlayer ipv4.dhcp-send-hostname yes
 fi
done < <(nmcli -g UUID connection show)
systemctl enable avahi-daemon
systemctl restart avahi-daemon
