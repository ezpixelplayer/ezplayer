# Experimental Etcher image build recipe

This stage is supplied for development. It has not been executed here. Do not distribute an image until the hardware checklist in README.md passes. It produces a fresh Raspberry Pi OS Desktop image with the rebuilt EZPlayer and the local Pi service; it does not clone customer data.

1. Rebuild the modified EZPlayer ARM64 package as described in README.md.
2. Use a native ARM64 Debian/Raspberry Pi OS build host and a reviewed, pinned ARM64 revision of official pi-gen: https://github.com/RPi-Distro/pi-gen/tree/arm64 . Follow its current dependency instructions. Record the exact commit and OS release with your generated image.
3. Prepare the custom stage:

   ```bash
   ./pi-appliance/prepare-pi-gen.sh /path/to/pi-gen /path/to/rebuilt-arm64.deb
   ```

4. In pi-gen's configuration, set a desktop build through stage4 followed by stage-ezplayer. Example values:

   ```bash
   IMG_NAME=EZPlayer-Pi-0.6.9-test
   TARGET_HOSTNAME=ezplayer
   FIRST_USER_NAME=ezplayer
   DISABLE_FIRST_BOOT_USER_RENAME=1
   ENABLE_SSH=0
   PASSWORDLESS_SUDO=0
   WPA_COUNTRY=US
   TIMEZONE_DEFAULT=America/New_York
   KEYBOARD_KEYMAP=us
   STAGE_LIST="stage0 stage1 stage2 stage3 stage4 stage-ezplayer"
   ```

   Set FIRST_USER_PASS to a newly generated strong password for your private test build (do not use a shared/default customer password). Keep the configuration private. Select the correct country/time zone for the installation. For customer production, implement first-boot password/account provisioning before distributing.

5. Place SKIP_IMAGES marker files in stage2 and stage4 to avoid exporting intermediate images. Do not add SKIP to stage4: its desktop packages are required. Keep the final stage-ezplayer/EXPORT_IMAGE.
6. Run the official build.sh on the native ARM64 host, following pi-gen's instructions. It needs internet access and substantial disk space. Services installed while building inside the chroot are expected to be started on actual boot, not during the image build.
7. Find the final image in pi-gen's deploy directory. If exported as a ZIP, extract the .img. Compress the resulting .img with xz if desired, and produce a SHA256 checksum. That .img/.img.xz is the Etcher input. This source ZIP is not an Etcher image.
8. Flash and test a fresh card. Verify account provisioning, automatic graphical login, Wi-Fi access before EZRGB registration, local audio, controller output, time zone, shutdown and power-loss recovery. Do not retain test Wi-Fi passwords, EZRGB tokens, downloaded paid sequences, or customer data in the distributable image.

Sources used for this recipe:
- Official pi-gen configuration and stages: https://github.com/RPi-Distro/pi-gen
- NetworkManager checkpoints: https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/gdbus-org.freedesktop.NetworkManager.html
- NetworkManager IPv4 settings: https://www.networkmanager.dev/docs/api/latest/settings-ipv4.html
