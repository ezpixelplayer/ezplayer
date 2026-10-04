# EZPlayer 0.6.9 Raspberry Pi integration — development test package

The desktop app version is 0.6.9-pi.1 to distinguish this development build from stock 0.6.9. This archive contains modified source, a local Pi settings service, installation/startup scripts, service tests and an experimental pi-gen image recipe. It is NOT a compiled installer or an Etcher-ready image. No Pi hardware test or ARM64 installer packaging has been performed here. The shared packages, desktop UI, Electron main-process TypeScript and preload compile have passed against the current repository.

## What changed

- Settings has Pi Network and Pi System tiles only when the local Pi service is installed.
- Welcome has a network setup button before EZRGB registration, so Wi-Fi can be connected first.
- Wi-Fi scanning and joining open or WPA/WPA2 personal networks using DHCP.
- Ethernet DHCP/static IPv4, CIDR subnet prefix, gateway and IPv4 DNS inputs.
- Controller-only Ethernet disables IPv4/IPv6 default routing, ignores DHCP DNS and disables IPv6 for that connection, leaving Wi-Fi to provide internet access.
- Network changes use a 120-second NetworkManager checkpoint. Activation may take up to 45 seconds; the remaining confirmation time is displayed in the app. Confirm to save or let NetworkManager restore the previous connection. A failed activation immediately requests rollback. Recovery still needs hardware testing.
- Audio settings remain the existing EZPlayer implementation. A separate test-output selector plays a low-level one-second tone through a detected output; it does not change playback output preferences or validate audio/light synchronization.
- System controls show hostname, network status, home-filesystem free space, and time zone; allow time zone changes, restarting EZPlayer, reboot and shutdown. Restart EZPlayer after time-zone changes before using its scheduler.
- Graphical automatic login and EZPlayer automatic startup/restart in a maximized window. The app runs as the desktop user; a restricted root helper talks to NetworkManager over D-Bus.
- The built-in Software Update tile is hidden when the Pi service is installed, and startup update checks are disabled by the service. Use rebuilt Pi releases for updates so a stock release does not erase this integration.
- Existing DDP/E1.31 output and source-IP binding are retained. Art-Net is outside scope.

## Rebuild the app

Use the project's existing ARM64 release build environment (the original release workflow already has a self-hosted ARM64 job). This modified source must be rebuilt; installing the ORIGINAL 0.6.9 .deb will not add the new settings.

The existing workflow uses Node 24 and pnpm 10. On a native ARM64 Linux build machine, install the existing project's build prerequisites, then from the source root:

```bash
pnpm install --frozen-lockfile
pnpm run build
```

The original build invokes native node-gyp and electron-builder. Use the ARM64 .deb under apps/ezplayer-ui-electron/release. Review/check the full TypeScript build, lint and original project tests before release. Preserve the original bundled local libraries and their lockfile.

## First Pi installation

Target: Raspberry Pi OS 64-bit Desktop (Trixie), a Pi 4/5, an existing non-root desktop account, monitor/keyboard/mouse for the initial test, and internet via Ethernet or preconfigured Wi-Fi while dependencies install. A fresh image can include those dependencies before first boot.

Copy pi-appliance and your rebuilt ARM64 .deb to the Pi. Run from pi-appliance:

```bash
sudo bash ./install-pi.sh /absolute/path/to/rebuilt-arm64.deb YOUR_USERNAME US
sudo reboot
```

Replace YOUR_USERNAME with the existing Pi desktop username and US with the actual two-letter Wi-Fi country. Installation configures automatic graphical login for that user. No EZRGB account details or Wi-Fi password is included in this package.

After reboot:
1. The graphical session starts EZPlayer automatically.
2. Use the Welcome button to connect Wi-Fi before registration, or use Settings > Pi Network.
3. Confirm a new network connection before the displayed timer expires.
4. Set Ethernet to the controller subnet, for example 192.168.50.2/24, and select controller-only mode if Ethernet is not your internet connection. Give controllers other addresses on that subnet.
5. Use existing Audio settings to choose show outputs; the test sound checks the selected test device separately.
6. Sign into EZRGB and complete normal show setup.

An initial setup screen may require choosing the normal show folder. This patch does not change cloud registration, music ownership checks, or customer account provisioning.

## GitHub Pi build

.github/workflows/pi-build.yml builds on a GitHub-hosted ARM64 runner for pull requests and manual runs. It checks the Pi service, builds and tests the app, verifies an ARM64 .deb exists, and uploads the installer plus pi-appliance scripts as a workflow artifact. It does not publish a release or run PR code on the lab's self-hosted runner.

## Image creation

See IMAGE-BUILD.md and prepare-pi-gen.sh. The image build requires a rebuilt ARM64 package and a reviewed official pi-gen checkout. The recipe has not been executed here. Keep SSH disabled in distributable images and implement customer first-boot credentials before production distribution.

## Verification completed in this workspace

- 21 Python service unit tests: configuration validation, checkpoint/revert/confirm, expiry, client UID/token ownership, failure rollback/error redaction, and power-action restrictions.
- Python compilation and shell syntax checks.
- Node syntax checking of the added Electron main-process TypeScript module.
- Dependencies installed with Node 24 and pnpm 10. Shared packages, embedded web app, desktop React build, renderer TypeScript, Electron main TypeScript/build and preload compilation passed; targeted ESLint passed. The audio conversion suite passed (21 tests). The controller-operation suite cannot enumerate host network interfaces in this restricted workspace; its 10 failures are an environment limitation. ARM64 packaging and complete CI validation remain outstanding.
- Systemd unit verification here cannot validate Pi-only executables and NetworkManager, which are not installed on this workstation.

## Required hardware acceptance checks

- Fresh boot, automatic login and application launch on Pi 4/5.
- Wi-Fi scan, correct/wrong password, confirm, timeout rollback, and reconnect after reboot.
- Ethernet DHCP and static settings, gateway/DNS persistence; Wi-Fi internet with controller-only Ethernet simultaneously.
- EZRGB login, downloads and file ownership checks.
- HDMI and USB audio, volume, selected-output persistence, unplug/replug and synchronization. Pi 4 analog audio if needed. Bluetooth pairing is not added by this patch.
- DDP and E1.31 with your actual layout, channel count and frame rate. Multicast routing must be checked on the two-network setup; existing source-IP binding is retained but this patch does not add a new multicast-interface selector.
- Scheduling, time zone and daylight saving; app crash restart; reboot, shutdown and power-loss recovery.
- Check device operation without an HDMI monitor separately; this app still uses a graphical session, and its existing headless mode disables local audio.

Known initial limits: no enterprise Wi-Fi, captive portal, hidden-SSID form, WPA3-only setup, Bluetooth pairing UI, or static IPv4 form for Wi-Fi. Existing OS tools can handle those during development; customer UI additions would need separate implementation/testing.

## Maintenance and rollback

Logs:
```bash
journalctl -u ezplayer-pi.service
journalctl --user -u ezplayer-desktop.service
```

To stop the app temporarily:
```bash
systemctl --user stop ezplayer-desktop.service
```

To remove appliance startup/settings, stop the user service, remove /etc/xdg/autostart/ezplayer-pi.desktop and /etc/lightdm/lightdm.conf.d/90-ezplayer-pi.conf, and disable ezplayer-pi.service. The EZPlayer .deb remains installed. Network changes that were confirmed remain NetworkManager profiles.

The service exposes only a Unix socket under /run/ezplayer-pi, restricted to the ezplayer-system group. It has no HTTP/TCP listener. Main-process IPC checks the local player main frame. Wi-Fi passwords are passed over local IPC/D-Bus and stored by NetworkManager, not printed or placed on shell command lines. Network configuration is per machine; no secrets are included in the source archive.
