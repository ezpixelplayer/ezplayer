EZPlayer Wi-Fi Health v1 - candidate for Pi testing

Changes:
- A missing iw channel reading is tolerated for 20 seconds instead of immediately
  moving the hotspot onto channel 6 while the station may still be on 5 GHz.
- Channel changes require two matching samples, checked roughly every second.
- hostapd STATUS is checked every five seconds. Persistent missing/disabled/
  wrong-channel control responses trigger AP-only recovery after startup grace.
- Legitimate DFS radar-check startup is allowed up to eleven minutes; no country
  rules, power limits, or DFS checks are bypassed.
- Recovery brings the virtual AP down/up and restarts hostapd. It does not
  disconnect/reconfigure the home Wi-Fi profile or reboot the Pi.
- INFO-level hostapd output and recovery reasons are retained in the journal.
- Healthy idle hotspots are not restarted on a schedule.

The updater retains saved band/network settings, Ethernet-only show rules,
latest portal text, logo/header, and port 80 routing. It does not change the
requested Wi-Fi band automatically. No player rebuild is needed.

INSTALL (stop playback first)
Extract EZPlayer-WiFi-Health-v1.zip into Downloads\EZPlayer-WiFi-Health-v1.
In Windows PowerShell:

powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\EZPlayer-WiFi-Health-v1\Apply-Pi-Image-Update.ps1"
scp -r "$env:USERPROFILE\Downloads\EZPlayer-WiFi-Health-v1" ezplayer@192.168.99.107:~/
ssh ezplayer@192.168.99.107

On the Pi:
cd ~/EZPlayer-WiFi-Health-v1
sudo bash ./install-wifi-health-update.sh

The hotspot briefly restarts. Initialization failures attempt rollback to the
previous backend and portal pages. Backups are in /var/lib/ezplayer-network.

TEST
1. Confirm setup and the hotspot still work on the known working 2.4 GHz band.
2. In Home Wi-Fi, select 5 GHz and connect, keeping the saved password.
3. Join EZPLAYER several times; record any delay and unsuccessful attempts.
4. Leave idle for 20 minutes, then overnight, without refreshing the player.
5. Check hotspot visibility and first-attempt association after each idle period.
6. Reboot and repeat. Check both home Internet access and show Ethernet output.

If it fails, before refreshing/restarting anything, run on the Pi:

iw dev
sudo hostapd_cli -p /run/ezplayer-network/hostapd -i ezsetup0 status
sudo journalctl -u ezplayer-network.service --since "20 minutes ago" --no-pager -l
sudo journalctl -k --since "20 minutes ago" --no-pager -l

Then return Home Wi-Fi to 2.4 GHz if you need the known working configuration.

LIMITS
These changes address identified recovery/channel-handling weaknesses, not a
confirmed root cause for every failed 5 GHz association. A responsive hostapd
reporting ENABLED is not proof that radio beacons are visible over the air.
Actual Pi/phone tests must establish reliability; automated tests cannot prove
5 GHz is as reliable as 2.4 GHz on this hardware/firmware. Both virtual Wi-Fi
interfaces still have to share the radio channel. Do not build a customer image
on the assumption that this candidate has already passed those hardware tests.
