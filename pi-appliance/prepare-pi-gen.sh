#!/bin/bash
set -euo pipefail
pi_gen_dir=$(realpath -- "${1:?Supply an existing pi-gen ARM64 checkout}")
package_path=$(realpath -- "${2:?Supply rebuilt modified arm64 .deb}")
[[ -f "$pi_gen_dir/build.sh" && -d "$pi_gen_dir/stage4" ]] || { echo 'Expected pi-gen checkout'; exit 1; }
[[ $(dpkg-deb -f "$package_path" Architecture) == arm64 ]] || { echo 'arm64 package required'; exit 1; }
[[ ! -e "$pi_gen_dir/stage-ezplayer" ]] || { echo 'stage-ezplayer already exists; choose a fresh checkout'; exit 1; }
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
cp -a "$script_dir/pi-gen-stage" "$pi_gen_dir/stage-ezplayer"
stage_files="$pi_gen_dir/stage-ezplayer/00-ezplayer/files"
mkdir -p "$stage_files"
cp -- "$package_path" "$stage_files/ezplayer-pi.deb"
cp -- "$script_dir"/{install-pi.sh,pi_service.py,pi_hotspot.py,pi_clock.py,initialize_show.py,setup_portal.py,ezplayer-pi.service,ezplayer-setup-portal.service,ezplayer-desktop.service,start-desktop.sh,ezplayer-autostart.desktop} "$stage_files/"
chmod +x "$pi_gen_dir/stage-ezplayer/prerun.sh" "$pi_gen_dir/stage-ezplayer/00-ezplayer/00-run.sh"
echo 'Stage prepared. Follow IMAGE-BUILD.md to configure and build. No image has been built yet.'
