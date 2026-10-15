# Flashable EZPlayer test image

The Pi ARM64 Build workflow now has two jobs: build the matching ARM64 application
installer, then build a fresh Raspberry Pi OS Desktop image on a hosted ARM64
runner. No self-hosted Pi runner or installed customer card is used.

Push this change to `codex/ezplayer-pi-appliance` (PR #260). The PR update triggers
the workflow automatically. After the image job succeeds, download the artifact
named `ezplayer-pi-image-<commit>`, extract it, and flash `EZPlayer-Pi-test.img.xz`
to a spare SD card using Etcher or Raspberry Pi Imager. The source update ZIP is
not flashable. Keep the working card unchanged.

See TEST-IMAGE-QUICKSTART.txt for first boot and physical testing. The image has
no home Wi-Fi credentials, EZRGB registration, paid sequences, or pre-generated
player identity. Each physical Pi generates its own identity on first boot.
Default Ethernet is EZRGB Mode. The optional physical reset service is disabled.

The image artifact contains a generated test login, checksum and build metadata.
SSH is off by default. This first build is for private hardware validation; a
customer first-boot password provisioning flow is not yet implemented.

## Native build

On a privileged native ARM64 Debian-based build host with pi-gen's dependencies:

```bash
sudo bash pi-appliance/build-test-image.sh /path/to/arm64.deb /path/to/new-output
```

The script pins official ARM64 pi-gen at
`d346cd53562b3c6b4f94c9155175f814258c456d`, uses Trixie Desktop through stage4,
and exports a compressed full disk image. A guarded copy_previous patch removes
only completed, unexported intermediate rootfs copies to reduce build disk usage.
Stage2 and stage4 image exports are skipped; stage-ezplayer is exported.

The normal installer has an explicit image-build mode: service restarts and
radio hardware calls are deferred, and initialize_show runs on first boot so
player IDs are never duplicated across flashed cards. The standalone networking
stack is installed offline and enabled for boot. The image builder records the
source commit and pi-gen revision in BUILD-INFO.txt.

Validation here covers stage preparation, script syntax, unique first-boot
identities, workflow YAML, Pi service tests, and the standalone network tests.
Full image generation requires privileged loop mounts on the GitHub runner and
has not run in the restricted workspace. Build and boot results are still pending.

Official pi-gen reference: https://github.com/RPi-Distro/pi-gen/tree/arm64
