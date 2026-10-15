#!/bin/bash -e
# Native ARM64 builder only; the installer intentionally checks the host architecture.
[[ $(uname -m) == aarch64 ]] || { echo 'Build this experimental stage on ARM64 Linux'; exit 1; }
[[ -f "${SUB_STAGE_DIR}/files/ezplayer-pi.deb" ]] || { echo 'Add rebuilt ezplayer-pi.deb to stage files first'; exit 1; }
install -d "${ROOTFS_DIR}/tmp/ezplayer-pi-build"
cp -a "${SUB_STAGE_DIR}/files/." "${ROOTFS_DIR}/tmp/ezplayer-pi-build/"
on_chroot <<EOF
EZPLAYER_IMAGE_BUILD=1 bash /tmp/ezplayer-pi-build/install-pi.sh /tmp/ezplayer-pi-build/ezplayer-pi.deb "${FIRST_USER_NAME}" "${WPA_COUNTRY}"
EZPLAYER_IMAGE_BUILD=1 bash /tmp/ezplayer-pi-build/network/install-image.sh "${WPA_COUNTRY}" "${FIRST_USER_NAME}"
EOF
# initialize_show must run on first boot, never in the image build.
if grep -R -l 'playerIdToken' "${ROOTFS_DIR}/home/${FIRST_USER_NAME}/.config/EZPlayer" "${ROOTFS_DIR}/home/${FIRST_USER_NAME}/EZPlayer/Show" 2>/dev/null; then
 echo 'A player identity was generated during build; refusing to export'; exit 1
fi
rm -rf "${ROOTFS_DIR}/tmp/ezplayer-pi-build"
