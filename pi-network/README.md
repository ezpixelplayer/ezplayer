# EZPlayer Pi network setup — first hardware-test build

Standalone captive portal, persistent setup hotspot, Wi-Fi and Ethernet management for Raspberry Pi OS with NetworkManager. Independent of EZPlayer. Defaults: **EZPLAYER / Ezrgb1234**. Setup page: **http://192.168.4.1**.

## Install on the test Pi

Copy this repository folder to the Pi. Keep Ethernet or a keyboard available during first testing. Disable the existing Pi Network tab's tethering mode before installing; do not run two hotspot managers together. The installer refuses an existing AP, conflicting port 80, or setup subnet conflict.

From the transferred folder run:

```bash
sudo bash ./install-pi.sh US
```

Use the actual two-letter country code. No account or home Wi-Fi credentials are included. Existing saved hotspot credentials are retained when updating. Join EZPLAYER on a phone. If no captive window appears, open http://192.168.4.1 manually. Select home Wi-Fi, enter its password and connect. The phone may disconnect briefly while the hotspot restarts on the home network's channel. Rejoin the hotspot to see status, then switch the phone to home Wi-Fi for registration in a normal browser at http://ezplayer.local:3000. The actual player hostname may differ.

## Reset button is part of the plan

Use a separate **normally-open momentary button**, not a power-cut or latching switch. Connect **BCM GPIO17 (physical pin 11)** to **GND (physical pin 9)** through the switch. Never connect the switch to 5V. Check that your other accessories do not occupy this GPIO. Wire only with power disconnected.

After installing a button, enable its service:

```bash
sudo systemctl enable --now ezplayer-reset-button.service
```

Hold continuously for **10 seconds** to restore hotspot name **EZPLAYER** and password **Ezrgb1234**, then restart the setup service. Home Wi-Fi profiles, LAN settings, EZPlayer registration, songs and show files remain untouched. The optional button service stays disabled until hardware is fitted. Uses gpiozero's lgpio backend for Pi 4 and Pi 5; verify gpiochip detection on your installed OS.

SSH recovery without a button:

```bash
sudo python3 /opt/ezplayer-network/network_service.py --reset-hotspot
```

## Implementation

- NetworkManager owns wlan0 and Ethernet. A separate virtual ezsetup0 AP is unmanaged by NetworkManager and runs hostapd.
- dnsmasq serves DHCP/DNS only on the setup interface. This is a local management network, without internet forwarding.
- HTTP port 80 listens on the hotspot address only. The page's LAN controls configure eth0, but the portal is accessed through setup Wi-Fi.
- HTTP captive checks redirect to the setup address. HTTPS is not intercepted; no claim of RFC 8908/8910 support is made.
- Wi-Fi connection changes acknowledge before applying. The AP pauses, then starts on the associated Wi-Fi channel. Failed connection attempts try restoring the previous Wi-Fi profile and restart the hotspot.
- Channel watchdog recovers the AP after station channel changes. There is no reliability guarantee until tested on real hardware.
- Credentials are stored in root-only files and never returned through status. Requests require a page token and the expected hotspot Host/Origin; subprocess arguments are passed without a shell.
- LAN supports DHCP or manual IPv4 and subnet masks, with optional gateway/DNS and controller-only routing.
- The default hotspot subnet must not overlap home Wi-Fi or Ethernet. This first build rejects overlap instead of automatically migrating the portal address.

## Hardware acceptance checklist

Test Pi 4 and Pi 5 separately. Verify initial setup without internet, correct and incorrect Wi-Fi passwords, AP channel transition on Android and iPhone, reboot persistence, home network loss/recovery, changed hotspot password and ten-second button reset. Test 2.4 GHz first; 5 GHz and DFS channel availability vary with country and driver, and can prevent the AP from starting. If a channel is unsupported, use a non-DFS home network for testing. Verify LAN DHCP/manual/controller-only settings with a spare controller network before running a show.

This is an installable first test build, **not a complete SD-card image or a hardware-validated release**. Integration with the existing EZPlayer tethering settings still needs to ensure that the old hotspot manager stays disabled.

## Troubleshooting and removal

```bash
sudo journalctl -u ezplayer-network.service -n 50
sudo systemctl status ezplayer-network.service
```

To stop the setup services and restore NetworkManager ownership configuration:

```bash
sudo systemctl disable --now ezplayer-reset-button.service ezplayer-network.service
sudo rm -f /etc/NetworkManager/conf.d/90-ezplayer-setup.conf
sudo nmcli general reload
sudo iw dev ezsetup0 del
```

This leaves saved Wi-Fi/LAN profiles and root-only hotspot settings intact.

## Local checks

```bash
python3 -m unittest discover -s tests -v
bash -n install-pi.sh
```

Reference: https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/nmcli.html
GPIO: https://gpiozero.readthedocs.io/en/stable/api_input.html

## Band selector update

New Wi-Fi connections default to 2.4 GHz. Auto leaves the band unrestricted; 5 GHz restricts association to 5 GHz. The hotspot still shares the station channel. Selecting a band takes effect when clicking Connect to Wi-Fi with the home network password. Installing this update does not change an existing Wi-Fi profile. The AP interface is temporarily brought down during association and brought up again afterward, matching the recovery tested on the Pi.

On the test Pi, the original ezplayer-pi.service was found repeatedly attempting to manage ezsetup0 despite portal tethering being turned off. It is currently stopped and disabled. Do not re-enable it until its hotspot management has been adapted; other Pi bridge controls are temporarily unavailable. Disabling only ezplayer-setup-portal.service was insufficient. 2.4 GHz concurrent operation and scans recovered after stopping the old bridge and releasing the AP during reconnection. 5 GHz remains unverified after these changes.

## Connected Wi-Fi display

The connected SSID populates the network dropdown even before a scan and appears to the right of Connected network. Refreshing shows a fixed dot placeholder for a password saved on the Pi; its actual value and length are not sent to the browser. A password entered during the session stays masked unless Show password is checked. Leaving the saved field unchanged allows the backend to reuse the current network's saved password when changing its band. Changing network selection clears the input and requires the new network's password. Status polling preserves the user's pending network selection. Saved credentials are not stored in browser local storage.

## Status reader fix

Connection state and SSID are read from NetworkManager. The form restores the saved SSID and band after refresh, including while disconnected. Saved display metadata contains no password. Connected network remains a live connection label. Tests cover missing iw SSID and disconnected saved configuration.

## Password, LAN and registration update

Show password explicitly retrieves the saved Wi-Fi password through a token-protected POST only when clicked. Regular status responses still contain no password. LAN status includes saved IPv4 settings read from NetworkManager, restoring DHCP/manual, address, subnet, gateway, DNS and controller-only routing. Settings can be saved without an Ethernet cable; activation occurs when carrier is available.

The finish-setup links point to the verified EZPlayer /cloud route, using the current Wi-Fi address when available. Phones must return to home Wi-Fi for internet-based registration.

### EZPlayer Settings shortcut (separate source patch)

Run Apply-Player-Portal-Shortcut.ps1 against D:\EZPlayer. It adds a Network Setup (Pi) tile to Electron and browser Settings with a link to http://192.168.4.1/setup. Both source insertion points are checked before either file is written; existing tiles are left intact. The shortcut does not depend on the temporarily disabled Pi bridge. On phones/computers join the setup hotspot before opening it. On the Pi that address is local. This update does not expose management to the home LAN.

Commit and push the EZPlayer repository separately and build/install a new Pi player package. This delivery verifies source insertion points but does not run the full EZPlayer UI builds or the PowerShell patch on Windows. Existing show files and registrations are unaffected. Use install-band-update.sh for the portal service update.

## Access from home Wi-Fi and Ethernet

The setup HTTP service now listens on IPv4 interfaces, including the setup hotspot, current home Wi-Fi address, Ethernet address, and loopback. The same page remains available at http://192.168.4.1/setup. On the home network, use http://<player-IP>/setup without :3000.

Home-network clients reaching the Pi at its current home Wi-Fi address open setup directly without an extra portal login. Hotspot clients and the local Pi also retain direct access. Other private-network access, including the Ethernet controller address, still requires the current hotspot password. Sessions use HttpOnly SameSite cookies, expire after one hour and are invalidated by hotspot password changes. Network operations still require a page token and same-origin requests. Arbitrary Host headers and public client addresses are rejected. Status never reveals credentials. Do not forward this port through your router.

Apply-Pi-Network-Link.ps1 changes the existing Pi Network tile to use the player hostname currently open in the browser, port 80. Packaged Electron uses 127.0.0.1. That player UI change requires a new build. Until then, open the home-network URL directly. The separate standalone network service update requires no new player build.

This adds home-network access without changing SSID/password defaults, persistent hotspot behavior, network profiles, reset button plan or system settings.

## Collapsible portal, Ethernet presets, and Advanced Home Wi-Fi

Only Home Wi-Fi starts expanded. Other sections can be expanded independently.
Ethernet offers EZRGB Mode, DHCP, and Manual IP Address. EZRGB Mode is enforced
by the service as 192.168.25.1/24, with no gateway or DNS, and never becomes the
internet default route. The UI shows these values as read-only. Manual fields
are editable; saved settings and the selected mode are restored on reload.

Advanced mode at the bottom reveals Home Wi-Fi DHCP/manual IPv4 settings.
Connect Home Wi-Fi first, then save its address settings separately. Existing
Wi-Fi passwords and band preferences are retained. Reconnecting the same SSID
also retains its saved manual IPv4 configuration. A failed activation attempts
to restore the previous settings; the hotspot is restarted in either case.

The installer sets hostname EZPlayer and enables Avahi for http://ezplayer.local/setup.
http://ezplayer/setup works on the hotspot; on home networks, the router must
resolve the DHCP hostname. The DHCP hostname is sent at the next lease request.
IP-address access remains available. Existing portal authentication is retained.

### Apply this update on Windows, then on the Pi

Extract EZPlayer-Portal-Modes-Update.zip into Downloads. In Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\EZPlayer-Portal-Modes-Update\Apply-Pi-Image-Update.ps1"
scp -r "D:\pi-image" ezplayer@192.168.99.107:~/
ssh ezplayer@192.168.99.107
```

If extraction produces another nested folder, use the actual path to the script.
Once the prompt reads ezplayer@ezplayer (on the Pi):

```bash
cd ~/pi-image
sudo bash ./install-band-update.sh
```

Refresh the setup page. No player application rebuild is needed for this update.
Before building the image, test EZRGB Mode with an Ethernet cable, DHCP and manual
settings after refresh/reboot, Home Wi-Fi manual/DHCP changes, and hostname access
from the phone. This update does not address the separately observed hotspot
broadcasting issue after long idle periods.

Automated verification: python3 -m unittest discover -s tests
UI verification: JSDOM_PATH=/path/to/jsdom node tests/test_portal.cjs

### Setup handoff update

After a confirmed Home Wi-Fi connection with an IP address, Home Wi-Fi collapses
and How to finish setup expands. This happens once per connection; subsequent
status checks respect sections the user opens or closes. An already connected
player also opens the finishing section on page load.

EZRGB Mode is the default Ethernet selection when no saved configuration exists.
Saved DHCP/manual selections still take precedence. Select EZRGB Mode and click
Save LAN settings to switch an existing player to the fixed controller address.

## Port 80 player and setup routing

See WEB-ACCESS-README.txt. New installations also configure nginx automatically.
Existing installations run install-web-access.sh once to move the portal to
loopback:8081 and route the base address to the player on port 3000.
The setup page stays at /setup, with the same authentication rules.

## Portal text update v3

New Home Wi-Fi connections default to Auto band. Saved band choices remain.
The band validation message has been removed. Ethernet description is now
Use Ethernet for controllers. New hotspot passwords are restricted to 8–20
ASCII characters on the page and server; Home Wi-Fi still accepts 8–63.
Finish setup now uses the requested two steps and keeps Open EZPlayer Cloud.
Run install-portal-update.sh for this update; it preserves port 80 routing and
saved settings and briefly restarts the network service.

### Hotspot base address

192.168.4.1/ is reserved for setup and redirects to /setup. Home Wi-Fi/LAN
base addresses continue opening the player. /player on the hotspot still works.
Run install-web-routing-update.sh to apply the routing change without restarting
the hotspot or player.

## Ethernet-only show output and logo

See SHOW-LAN-README.txt for installation, normal protocol-port scope, recovery
behavior, and required physical Pi/controller validation. New installs also
install the guard. Both portal pages use the original supplied logo.

## Wi-Fi health candidate v1

See WIFI-HEALTH-README.txt for the recovery changes and required 5 GHz phone/idle
validation. Saved band choices remain unchanged. The root cause of the
intermittent 5 GHz association/broadcast issue is not yet established.
