# Pi settings and local imports update

Extract EZPlayer-Pi-Settings-Update.zip to a separate folder. Run its Apply-Pi-Update.ps1 using PowerShell; it copies the update into D:\EZPlayer and removes the two retired pi-show-folder helper/test files from the earlier update. It also restores the original startup and WelcomeScreen files. Use -Repository to target another repository folder or -WhatIf to preview. In GitHub Desktop on codex/ezplayer-pi-appliance, commit with "Improve Pi setup, offline clock and local song uploads" and Push origin. Download the new successful Pi ARM64 artifact, transfer it to the Pi, stop ezplayer-desktop.service, run its updated install-pi.sh with the new .deb and the desktop username, and reboot. Both the rebuilt app and updated integration scripts are required.

## Network

Wi-Fi and Ethernet settings appear first. Tethering is at the bottom, with Auto/Off, editable SSID and editable password. Show password reveals the saved password. Changing active setup credentials disconnects devices; rejoin with the new values. Auto stays available when only controller Ethernet is connected, and shuts off when infrastructure Wi-Fi connects.

## Clock and time zone

Pi System lists time zones from Raspberry Pi OS and reads the actual systemd time zone rather than a potentially stale /etc/timezone file. A time zone determines local schedule times; NTP synchronizes the clock separately. Restart EZPlayer after changing the time zone so its schedule process uses the new zone.

Internet synchronization can be turned on or off. Offline date and time are interpreted in the player's displayed time zone, even when the phone/computer uses another zone. Setting time manually disables NTP. Invalid dates and skipped/repeated daylight-saving times are rejected. Stop playback before clock changes because scheduled shows depend on the clock.

Hardware clocks, including RasClock, are managed by Raspberry Pi OS. EZPlayer does not detect, select, write or restore RTC devices.

## Show storage at installation

On first installation, install-pi.sh runs initialize_show.py as the desktop user. It creates ~/EZPlayer/Show, seeds the existing cloud-managed folder format and a stable player ID, and saves showFolder in the packaged app's electron-store settings. EZPlayer's existing startup validation recognizes the folder and skips the folder prompt. Startup and WelcomeScreen code are restored to their original behavior; there is no added registration-first screen flow. Registration remains in the existing Cloud UI and phone handoff.

An already selected show folder and all existing preferences are preserved. Upgrading does not change that selection, move a show or regenerate its player ID. Invalid settings are reported rather than overwritten. Stop EZPlayer before installing so its settings file cannot race the installer.

## Songs

On the local browser control page, Add Song uploads each selected FSEQ/audio file to the Pi. Bulk Import offers Upload FSEQ and audio files, Upload folder, or Import files already on player. Include companion audio in the selection/folder; the existing metadata/autodetection and import summary are reused. Files in subfolders are flattened by the existing browser uploader, so use distinct names for different songs.

When using the Pi's desktop, Add Song and bulk import copy external song files into the managed show's imports directory when saving, then save those Pi paths. Songs remain available after USB/source storage is removed. Desktop paths are fingerprinted to avoid replacing another source with the same filename. Existing files already inside the show folder are reused. File copying is restricted to local desktop IPC imports; the cloud cannot request it through sequence metadata updates. Cloud-proxied file upload writes are rejected on appliances. LAN/hotspot uploads remain available, and cloud sequence downloads retain their existing workflow.

## Validation still needed on Pi

Test time-zone save and restart, manual clock/NTP toggles, first-install folder initialization and prompt skipping, existing-show preservation, single and bulk browser uploads, and desktop imports followed by removing source storage. Software builds and mock clock tests cannot verify radio behavior or power-loss protection. The planned protected filesystem image remains separate work.
