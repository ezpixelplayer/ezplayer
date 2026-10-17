# Phone setup Wi-Fi

This source update includes separate IP address/subnet mask fields and the setup hotspot. It must be rebuilt into the ARM64 app, and its updated pi-appliance scripts must also be installed. Copying only the .deb does not install the new hotspot services.

## Put this update into GitHub Desktop

1. Extract EZPlayer-Tethering-Update.zip.
2. Copy its contents into D:\EZPlayer, merging folders and replacing the matching files. Keep the relative folders: apps, packages, pi-appliance and .github.
3. In GitHub Desktop, select the codex/ezplayer-pi-appliance branch. Commit with the summary "Add phone Wi-Fi setup and tethering modes", then Push origin. The existing pull request triggers the Pi ARM64 build.
4. Download the successful build artifact, extract it to D:\EZPlayer-Pi-Build and transfer it to the Pi as before.
5. Run the updated install-pi.sh with the rebuilt ARM64 .deb and desktop username, then reboot. For the current development installation the desktop username is ezplayer. Keep actual Wi-Fi credentials out of commits and distributable images.

## What the user sees

In Settings > Pi Network, choose Tethering:

| Mode | Behavior |
| --- | --- |
| Auto (default) | Allows 45 seconds for saved Wi-Fi to connect. If no infrastructure Wi-Fi connects, starts setup Wi-Fi. Turns setup Wi-Fi off after a successful Wi-Fi connection. Ethernet connectivity does not disable Auto setup Wi-Fi. After a later Wi-Fi disconnection, waits 45 seconds for reconnection before offering setup Wi-Fi again. |
| Off | Stops setup Wi-Fi and leaves it off across reboots. The user must use a monitor/keyboard, SSH if separately enabled, or the existing LAN connection to configure networking. |

The default setup SSID is EZPlayer and its WPA2 password is Ezrgb123. Users can change both in Pi Network. Defaults apply only when no hotspot configuration has been saved; existing installations retain their saved credentials.


1. On the phone, select the player's setup Wi-Fi and enter its setup password.
2. The phone's captive-network detection should open the player with Pi Network selected. If it does not, stay connected to setup Wi-Fi and open http://192.168.4.1 in the browser. A phone may warn that this Wi-Fi has no internet; it is a local setup network.
3. Scan for home Wi-Fi, select its SSID and enter the password. If scanning is limited while AP mode is active, enter the network name manually. Open and WPA/WPA2 personal networks are supported; WPA3-only/enterprise networks are not supported by this form.
4. Press Connect. The page acknowledges the attempt before switching the radio. In Auto, the phone disconnects when the Pi joins home Wi-Fi. The helper waits for NetworkManager to verify the new connection and then confirms it without asking the disconnected phone to press Keep connection.
5. On failure, the checkpoint restores the previous connection and setup Wi-Fi is offered again. Rejoin the player's setup Wi-Fi to correct the password. The phone page prepares the existing HTTPS cloud registration URL with the same player ID before changing Wi-Fi (creating and persisting an ID if needed). In Auto mode it waits at least 30 seconds, then tries registration when the phone can reach the cloud over HTTPS. It also displays an Open player registration link and Cancel redirect. Reconnect the phone to home Wi-Fi or use mobile data; registration and subsequent cloud player access use the existing cloud flow.

Closing Pi Network exposes the normal Settings tiles and player sidebar. Songs, playlists, schedule and other existing tabs use the regular phone UI; they have not been replaced by a separate setup-only page.

## Implementation and deployment limits

- NetworkManager provides the WPA2 AP, DHCP and DNS. Setup uses 192.168.4.1/24; a conflicting controller/home subnet is rejected. This subnet is currently fixed.
- DNS on shared interfaces points captive probes to the setup portal. The setup hotspot is for local player administration, rather than general internet tethering.
- Port 80 must be free for ezplayer-setup-portal.service. The proxy discovers the player's actual control port, including port fallback, and accepts traffic only addressed to the setup interface from 192.168.4.0/24.
- The root helper has no TCP listener. The portal runs as its own unprivileged account, with permission only to bind port 80 and read the registered player port. The control UI offers the limited Pi API on trusted local addresses, requires same-origin JSON requests with a custom header, and excludes privileged web-port registration from browser access. The public kiosk does not expose Pi administration.
- Modes and setup credentials are saved atomically with restricted permissions. They still need to be placed in persistent storage when the planned read-only image is implemented. This update does not yet implement that image protection.
- Phone captive-page behavior, actual AP support, D-Bus activation/rollback, regulatory channels and two-adapter behavior must be tested on the Pi 5. Software tests do not substitute for those hardware checks.

## Recovery

If the setup page does not load, inspect:

```bash
systemctl status ezplayer-pi ezplayer-setup-portal --no-pager
journalctl -u ezplayer-pi -u ezplayer-setup-portal -n 50 --no-pager
```

If another service occupies port 80, resolve that conflict before testing the captive portal. If home Wi-Fi is connected in Auto, the absence of the setup SSID is expected. Network settings remain editable during playback; the existing interruption warning remains in place.

The player cannot force a phone to select another Wi-Fi network or keep its captive browser open. With a single radio the page cannot observe the final Pi connection after the hotspot disappears: automatic navigation means the phone can reach the cloud, not confirmation that the Pi joined successfully. Wrong-password failures restore setup Wi-Fi; rejoin it to retry. If the phone closes the captive window, use the prepared registration link in the normal browser. Cloud-disabled installations keep their existing opt-out; resume cloud activity to use registration.

Setup Wi-Fi name and password are editable in Pi Network. SSIDs contain 1–32 UTF-8 bytes without control characters; passwords contain 8–63 printable ASCII characters. Leaving the new password blank preserves the current password. Changing active setup credentials restarts the hotspot after the response, disconnecting its devices; reconnect with the new credentials. Updates persist atomically with file mode 0600. Previous Always on configurations migrate to Auto.
