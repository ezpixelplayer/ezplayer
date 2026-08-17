---
sidebar_position: 1
title: Registering
---

# Registering

Registration links an EZPlayer show folder to your [EZRGB](https://ezrgb.com) account.
Once connected, the player can:

1. Download your sequences from the cloud
2. Sync your layout with the cloud service
3. Appear under **EZPlayer** on your EZRGB account, so you can open the full
   player UI over the internet (**Manage Player**)

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
below) or on another device by scanning the QR code. When EZRGB confirms the
player, EZPlayer pulls your layout automatically and then opens the main app.

For the full walkthrough from first launch through scheduling, see
[Getting Started (Cloud)](../basics/getting-started-cloud.md).

## Registering later

If you skipped cloud setup on first launch — or you opened an existing xLights
show folder and now want remote control or EZRGB sequence sync — register at any
time from either:

- The **Cloud** screen in the sidebar — click **Register Player**, or
- **Settings → Cloud** — opens the same registration dialog.

![Cloud screen — not connected](/img/cloud-screen.png)

The QR code and link work the same way as on first launch. On a mid-session
register, layout and sequences sync on the next cloud poll (or immediately if
you click **Sync Content Now** / **Sync Layout + Content** on the Cloud screen).

You can also start a fresh cloud-managed folder later from
**Settings → Show Folder → Download Cloud Show**, then register from the Cloud
screen.

## Completing registration

While waiting, EZPlayer shows **Waiting for Registration** with a spinner.
Finish associating the player on the EZRGB website:

1. **Scan the QR code** with a phone or tablet that can open a browser, **or**
2. **Open the registration link** — click it in EZPlayer (desktop app) or paste
   it into a browser.

The link opens the EZRGB claim page for this player. Log in to your EZRGB
account if prompted, then follow the site prompts to claim the player.

When registration succeeds:

- In EZPlayer, the status changes to **Player ID Registered** (green checkmark).
  EZPlayer detects this automatically — you do not need to restart the app.
- On [EZRGB](https://ezrgb.com), the player appears under **EZPlayer** on your
  account screen. From there, click **Manage Player** to open the full remote
  player UI in the browser (open it in a new tab for more screen space).

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
  syncs sequences and other content. You can push layout updates to the cloud
  from the Cloud screen (**Push Layout**), or switch to cloud-managed later.

From the website, use **Manage Player** for remote status and control, or manage
layout / sequences / schedule on [EZRGB](https://ezrgb.com) and let them sync
down. See [Using Full Cloud Control](./full-cloud-control.md).

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
