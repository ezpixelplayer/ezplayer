#!/bin/bash -e
# Native ARM64 builder only; the installer intentionally checks the host architecture.
[[ $(uname -m) == aarch64 ]] || { echo 'Build this experimental stage on ARM64 Linux'; exit 1; }
[[ -f "${SUB_STAGE_DIR}/files/ezplayer-pi.deb" ]] || { echo 'Add rebuilt ezplayer-pi.deb to stage files first'; exit 1; }
install -d "${ROOTFS_DIR}/tmp/ezplayer-pi-build"
cp -a "${SUB_STAGE_DIR}/files/." "${ROOTFS_DIR}/tmp/ezplayer-pi-build/"
on_chroot <<EOF
bash /tmp/ezplayer-pi-build/install-pi.sh /tmp/ezplayer-pi-build/ezplayer-pi.deb "${FIRST_USER_NAME}" "${WPA_COUNTRY}"
EOF
rm -rf "${ROOTFS_DIR}/tmp/ezplayer-pi-build"
