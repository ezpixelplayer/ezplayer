#!/bin/bash -e
# Native ARM64 builder only; the installer intentionally checks the host architecture.
[[ $(uname -m) == aarch64 ]] || { echo 'Build this experimental stage on ARM64 Linux'; exit 1; }
# pi-gen runs this script from its substage but does not export SUB_STAGE_DIR.
stage_files="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/files"
[[ -f "${stage_files}/ezplayer-pi.deb" ]] || { echo 'Add rebuilt ezplayer-pi.deb to stage files first'; exit 1; }
python3 "${stage_files}/configure_boot_display.py" "${ROOTFS_DIR}/boot/firmware/cmdline.txt"
# on_chroot mounts tmpfs over /tmp and /run; stage outside those paths.
install -d "${ROOTFS_DIR}/opt/ezplayer-image-build"
cp -a "${stage_files}/." "${ROOTFS_DIR}/opt/ezplayer-image-build/"
on_chroot <<EOF
EZPLAYER_IMAGE_BUILD=1 bash /opt/ezplayer-image-build/install-pi.sh /opt/ezplayer-image-build/ezplayer-pi.deb "${FIRST_USER_NAME}" "${WPA_COUNTRY}"
EZPLAYER_IMAGE_BUILD=1 bash /opt/ezplayer-image-build/network/install-image.sh "${WPA_COUNTRY}" "${FIRST_USER_NAME}"
EOF
# initialize_show must run on first boot, never in the image build.
if grep -R -l 'playerIdToken' "${ROOTFS_DIR}/home/${FIRST_USER_NAME}/.config/ezplayer-ui-electron" "${ROOTFS_DIR}/home/${FIRST_USER_NAME}/.config/EZPlayer" "${ROOTFS_DIR}/home/${FIRST_USER_NAME}/EZPlayer/Show" 2>/dev/null; then
 echo 'A player identity was generated during build; refusing to export'; exit 1
fi
rm -rf "${ROOTFS_DIR}/opt/ezplayer-image-build"
