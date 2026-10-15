#!/usr/bin/env bash
# Native ARM64, privileged ephemeral Linux build host only.
set -euo pipefail
[[ $EUID -eq 0 && $(uname -m) == aarch64 ]] || { echo 'Run as root on a native ARM64 build host.'; exit 1; }
package=$(realpath -- "${1:?Supply the rebuilt ARM64 .deb}")
output=$(realpath -m -- "${2:?Supply output directory}")
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir=$(dirname "$script_dir")
[[ $(dpkg-deb -f "$package" Architecture) == arm64 ]] || { echo 'ARM64 package required'; exit 1; }
[[ -z $(find "$output" -maxdepth 1 -name '*.img*' -print -quit 2>/dev/null) ]] || { echo 'Choose an empty output folder.'; exit 1; }
install -d -m 700 "$output"
workspace=$(mktemp -d /tmp/ezplayer-pi-gen.XXXXXX)
# Pinned official ARM64 pi-gen; record it alongside the image.
pi_gen_sha=d346cd53562b3c6b4f94c9155175f814258c456d
git clone --no-checkout https://github.com/RPi-Distro/pi-gen.git "$workspace/pi-gen"
git -C "$workspace/pi-gen" checkout --detach "$pi_gen_sha"
python3 - "$workspace/pi-gen/scripts/common" <<'PYSPACE'
import pathlib,sys
p=pathlib.Path(sys.argv[1]);text=p.read_text()
needle='\trsync -aHAXx --numeric-ids --exclude var/cache/apt/archives "${PREV_ROOTFS_DIR}/" "${ROOTFS_DIR}/"'
assert text.count(needle)==1, 'Pinned pi-gen copy_previous layout changed'
cleanup='''
	if [ "${EZPLAYER_RECLAIM_PREVIOUS:-0}" = 1 ] && [ "$PREV_ROOTFS_DIR" != "$ROOTFS_DIR" ] && [[ "$PREV_ROOTFS_DIR" == "$WORK_DIR/"*/rootfs ]] && { [ ! -f "$PREV_STAGE_DIR/EXPORT_IMAGE" ] || [ -f "$PREV_STAGE_DIR/SKIP_IMAGES" ]; }; then
		rm -rf -- "$PREV_ROOTFS_DIR"
	fi'''
p.write_text(text.replace(needle,needle+cleanup))
PYSPACE
bash "$script_dir/prepare-pi-gen.sh" "$workspace/pi-gen" "$package"
password='Ezplayer1'
# Mask the configured test login if building in GitHub Actions.
if [[ ${GITHUB_ACTIONS:-} == true ]]; then printf '::add-mask::%s\n' "$password"; fi
umask 077
cat > "$workspace/pi-gen/config" <<CONF
IMG_NAME=EZPlayer-Pi-test
PI_GEN_RELEASE='EZPlayer test image'
RELEASE=trixie
TARGET_HOSTNAME=EZPlayer
FIRST_USER_NAME=ezplayer
FIRST_USER_PASS=$password
DISABLE_FIRST_BOOT_USER_RENAME=1
ENABLE_SSH=0
PASSWORDLESS_SUDO=0
WPA_COUNTRY=US
TIMEZONE_DEFAULT=America/New_York
LOCALE_DEFAULT=en_US.UTF-8
KEYBOARD_KEYMAP=us
KEYBOARD_LAYOUT='English (US)'
DEPLOY_COMPRESSION=xz
COMPRESSION_LEVEL=3
STAGE_LIST="stage0 stage1 stage2 stage3 stage4 stage-ezplayer"
CONF
touch "$workspace/pi-gen/stage2/SKIP_IMAGES" "$workspace/pi-gen/stage4/SKIP_IMAGES"
printf 'Private hardware-test login\nUsername: ezplayer\nPassword: %s\nSSH is disabled by default. This is the configured hardware-test account password.\n' "$password" > "$output/TEST-LOGIN.txt"
unset password
umask 022
export EZPLAYER_RECLAIM_PREVIOUS=1
(
 cd "$workspace/pi-gen"
 ./build.sh -c config
)
shopt -s nullglob
images=("$workspace/pi-gen/deploy/"*.img.xz)
[[ ${#images[@]} -eq 1 ]] || { echo 'Expected exactly one flashable image.'; exit 1; }
install -m 600 "${images[0]}" "$output/EZPlayer-Pi-test.img.xz"
source_sha=$(git -c safe.directory="$repo_dir" -C "$repo_dir" rev-parse HEAD)
package_version=$(dpkg-deb -f "$package" Version)
printf 'source_commit=%s\npi_gen_commit=%s\npackage_version=%s\nos=Raspberry Pi OS Desktop ARM64 Trixie\nhostname=EZPlayer\ncountry=US\nimage_type=hardware-test\n' "$source_sha" "$pi_gen_sha" "$package_version" > "$output/BUILD-INFO.txt"
cp "$script_dir/TEST-IMAGE-QUICKSTART.txt" "$output/READ-ME-FIRST.txt"
(cd "$output" && sha256sum EZPlayer-Pi-test.img.xz > SHA256SUMS)
echo "Flashable image created in $output"
echo "Temporary build tree: $workspace"
