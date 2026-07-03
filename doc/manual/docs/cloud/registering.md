---
sidebar_position: 1
title: Registering
---

# Registering

Registration links this EZPlayer install to your [EZRGB](https://ezrgb.com) account.
Once connected, the player can download your layout and sequences from the cloud
and show up in your EZRGB dashboard for remote status and control.

You only need to register once per show folder. If you reopen a folder that is
already registered, EZPlayer picks up where you left off.

## First-time setup (cloud-managed show)

If you are starting fresh with EZRGB Cloud:

1. On the welcome screen, choose **Connect to EZRGB Cloud**.
2. Pick a **show folder** — an empty folder works well for a new cloud-managed
   show.
3. The registration screen appears with a QR code and a link.

![Cloud registration](/img/FirstRunCloudReg.png)

Complete registration in your browser (see [Completing registration](#completing-registration)
below). When EZRGB confirms the player, EZPlayer pulls your layout automatically
and then opens the main app.

For the full walkthrough from first launch through scheduling, see
[Getting Started (Cloud)](../basics/getting-started-cloud.md).

## Registering later

You can register at any time if you skipped cloud on first launch — for example,
if you started with an xLights show folder and want to sync sequences from
EZRGB later.

Open registration from either place:

- The **Cloud** screen in the sidebar — click **Register Player** when the player
  is not connected.
- **Settings → Cloud** — opens the same registration dialog.

![Cloud screen — not connected](/img/cloud-screen.png)

The QR code and link work the same way as on first launch.

## Completing registration

While waiting, the screen shows **Waiting for Registration** with a spinner.
Finish the claim on EZRGB using either option:

1. **Scan the QR code** with a phone or tablet that can open a browser.
2. **Open the registration link** — click it in EZPlayer (desktop app) or copy
   it into a browser on another device.

You must be **logged in to your EZRGB account** in that browser. Follow the
prompts on the EZRGB site to claim this player.

When registration succeeds, the status changes to **Player ID Registered** with
a green checkmark. EZPlayer detects this automatically — you do not need to
restart the app.

## If cloud is paused

If the screen shows **Cloud Paused**, registration cannot complete until cloud
activity is running again. Click **Resume Cloud**, then use the QR code or link
as usual. Your player ID and settings are kept while paused.

## After registration

What happens next depends on how your show folder is set up:

- **Cloud-managed show** — EZPlayer downloads your layout from EZRGB, then keeps
  sequences, playlists, and schedule in sync. Watch progress on the **Cloud**
  screen in the sidebar.
- **xLights show folder** — your local layout stays in charge; the cloud mainly
  syncs sequences and other content. You can push or pull the layout from the
  Cloud screen when you are ready.

From here, build playlists and schedules in EZPlayer, or manage content on
[EZRGB](https://ezrgb.com).

## Troubleshooting

**The status stays on "Waiting for Registration"**

- Make sure you finished the claim flow on EZRGB while logged into the correct
  account.
- Confirm the player has internet access and cloud is not paused.
- Try opening the registration link again in a fresh browser tab.

**You need to connect a different EZRGB account or replace this player**

- On the Cloud screen, use **Disconnect** to clear the current registration,
  then register again with a new QR code.
- To reuse a player that is already registered in the cloud, paste its Player ID
  under **Advanced** in the registration dialog. See [Cloud settings](../settings/cloud.md)
  for details.

**You want to change how often content syncs, pause cloud, or point at a different
cloud server**

- See [Cloud settings](../settings/cloud.md) for polling schedule, pause/resume,
  and other advanced options.
