EZPlayer Web Access v1

On home Wi-Fi/LAN, the player opens at http://PLAYER-IP/ and the network portal at
http://PLAYER-IP/setup. Port 3000 remains available for compatibility.
http://ezplayer.local/ works when local hostname discovery is available.
The bare name http://ezplayer/ still depends on the client's DNS resolution.

The hotspot remains independent of the player. Phone connectivity probes
redirect to the setup portal. Home network portal access still requires the
setup hotspot password; loopback and direct hotspot access remain direct.

INSTALL ON AN EXISTING PI
Extract the ZIP into Downloads\EZPlayer-Web-Access-v1.
In Windows PowerShell:

powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\EZPlayer-Web-Access-v1\Apply-Pi-Image-Update.ps1"
scp -r "$env:USERPROFILE\Downloads\EZPlayer-Web-Access-v1" ezplayer@192.168.99.107:~/
ssh ezplayer@192.168.99.107

Then ON THE PI:
cd ~/EZPlayer-Web-Access-v1
sudo bash ./install-web-access.sh

The installer needs Internet access to install nginx. It backs up the current
portal and web configuration and attempts rollback if installation fails.
This restarts the hotspot briefly. It does not modify home Wi-Fi credentials,
Ethernet settings, or the player's application package.

VERIFY
1. Open http://192.168.99.107/ and confirm the player and live status work.
2. Open http://192.168.99.107/setup and verify home-network setup login.
3. Check Songs, file uploads, Cloud registration, and Pi Network shortcut.
4. Join EZPLAYER and verify the automatic setup page still appears.
5. Reboot and repeat the player and portal checks.

This routing update does not claim to fix intermittent hotspot broadcasting.
Continue the independent 2.4 GHz idle/reconnection test.

Implementation: nginx listens on port 80; the network portal is bound only to
127.0.0.1:8081. nginx overwrites forwarded address headers, and the portal uses
those addresses for access checks and session binding. WebSockets, streaming,
and player uploads are proxied. The player loopback-only shell reload endpoint
is blocked through the proxy. No new player build is required.

Hotspot exception: http://192.168.4.1/ opens Network Setup.
http://192.168.4.1/player still opens the player.
