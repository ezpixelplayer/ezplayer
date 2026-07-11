---
sidebar_position: 1
title: Registering
---

# Registering

Registration links an EZPlayer show folder to your [EZRGB](https://ezrgb.com) account.
Once connected, the player can:

1. Download your sequences from the cloud
2. Sync your layout with the cloud service
3. Show up in your EZRGB dashboard for remote status and control over the internet

You only need to register once per show folder. If you reopen a folder that is
already registered, EZPlayer picks up where you left off.

## First-time setup (cloud-managed show)

If you are starting fresh with EZRGB Cloud:

1. On the welcome screen, choose **Connect to EZRGB Cloud**.
2. Pick a **show folder** — an empty folder works well for a new cloud-managed
   show.
3. The registration screen appears with a QR code and a link.

![Cloud registration](/img/FirstRunCloudReg.png)

Complete registration in your browser locally (see [Completing registration](#completing-registration)
below) or on another device by scanning the QR code. When EZRGB confirms the player, EZPlayer pulls your layout automatically
and then opens the main app.

For the full walkthrough from first launch through scheduling, see
[Getting Started (Cloud)](../basics/getting-started-cloud.md).

## Registering later

If you skipped cloud setup on first launch and want to enable remote control or EZRGB sequence sync, you can register at any time by visiting either:

- The **Cloud** screen from the sidebar — click **Register Player**, or
- **Settings → Cloud** — opens the same registration dialog.

![Cloud screen — not connected](/img/cloud-screen.png)

The QR code and link work the same way as on first launch.

## Completing registration

While waiting, the screen shows **Waiting for Registration** with a spinner.
Finish associating the player on the EZRGB website by either:

1. **Scanning the QR code** with a phone or tablet that can open a browser.
2. **Open the registration link** — click it in EZPlayer (desktop app) or copy
   it into a browser.

Follow the prompts on the EZRGB site to claim this player. If you have not logged in to your EZRGB account,
you will be asked to do so.

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
  sequences, playlists, and schedule in sync. Watch progress on the
  [Cloud screen](./status-control-ui.md).
- **xLights show folder** — your local layout stays in charge; the cloud mainly
  syncs sequences and other content. You can push layout updates to the cloud from the
  Cloud screen.

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
