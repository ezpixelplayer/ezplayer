EZPlayer Ethernet Show Output + Logo v1

Home Wi-Fi remains the internet connection. Standard DDP (UDP 4048) and
E1.31/sACN (UDP 5568), both unicast and multicast, are routed through eth0.
An output firewall drops these show packets if they would leave through any
other interface, including wlan0 and the setup hotspot. An unreachable route
prevents default internet-route fallback when Ethernet is down. Unrelated
internet traffic, controller web pages, and portal routes are not changed.

Scope: IPv4 show output on the normal DDP and sACN ports. The player's developer
DDP destination-port override is not covered; do not use custom DDP ports in
this appliance configuration. Art-Net output is not added by this update.

The original supplied logo replaces the brand text on both setup and setup
login. The image is embedded, so it requires no separate image server request.
EZRGB Mode still sets controller-only networking automatically.

INSTALL
Stop playback first. Extract EZPlayer-Show-LAN-Logo-v1.zip into Downloads\EZPlayer-Show-LAN-Logo-v1.
In WINDOWS POWERSHELL:

powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\EZPlayer-Show-LAN-Logo-v1\Apply-Pi-Image-Update.ps1"
scp -r "$env:USERPROFILE\Downloads\EZPlayer-Show-LAN-Logo-v1" ezplayer@192.168.99.107:~/
ssh ezplayer@192.168.99.107

Then ON THE PI:
cd ~/EZPlayer-Show-LAN-Logo-v1
sudo bash ./install-show-lan-update.sh

The installer needs internet access for nftables/tcpdump. It briefly restarts
the network portal/hotspot. Existing Wi-Fi, Ethernet settings, and web proxy
configuration are retained. Restart EZPlayer after installation to recreate
existing UDP sockets. No player rebuild is required.

VERIFY ON THE PI BEFORE CREATING AN IMAGE
Connect Ethernet and select/save EZRGB Mode if not already selected.
Replace 192.168.25.2 below with the real controller IP if different.

ip -4 route get 192.168.25.2 ipproto udp dport 4048
ip -4 route get 239.255.0.1 ipproto udp dport 5568
ip -4 route get 1.1.1.1 ipproto tcp dport 443

Show routes should say dev eth0; internet should say dev wlan0.
Run a sequence with a real controller. In separate SSH sessions:

sudo tcpdump -ni eth0 'udp dst port 4048 or udp dst port 5568'
sudo tcpdump -ni wlan0 'udp dst port 4048 or udp dst port 5568'

Frames should appear on Ethernet, never Wi-Fi. Unplug Ethernet during playback:
Wi-Fi should still show no show packets, while cloud/internet remains usable.
Reconnect, then reboot and repeat. Inspect the guard with:

sudo systemctl status ezplayer-show-output.service --no-pager -l
sudo nft list table inet ezplayer_show

Automated checks cover firewall-before-routing order, no fallback route,
Ethernet down behavior, collision handling, reloads, portal auth, routing,
WebSockets and UI. Kernel packet routing could not be exercised in the build
workspace because network-administration privileges are unavailable; the
physical Pi/controller tests above remain necessary.

BOOT AND OWNERSHIP
The guard runs before the desktop/player and is required by the display
manager, so the desktop does not start if guard installation fails at boot.
Ethernet changes refresh the owned rules through NetworkManager's dispatcher.
Only nft table inet ezplayer_show, IPv4 table 4048, and policy priorities
10448/10449 are owned. Other firewall tables and main routes are retained.

This does not resolve the separate intermittent hotspot visibility issue.
