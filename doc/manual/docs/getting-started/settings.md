---
sidebar_position: 3
title: Settings
---

# Settings

![Settings](/img/settings.png)

Open **Settings** from the sidebar to configure how EZPlayer looks, sounds, and
connects to the outside world. The screen shows a grid of tiles — click one to
open its dialog.

Most **playback settings** (show-folder, ui, viewer control, jukebox, audio, cloud, player) save
automatically when you change them. They are stored in your show folder and
pushed to the playback engine right away. You can also change them from the
[LAN UI](../reference/api.md) or the HTTP API (`POST /api/playback-settings`).

**UI settings** (theme, scale, 3D controls) are stored in the browser on that
device only.

The desktop app and the LAN browser UI share the same settings sections, except
where noted below.

## Show Folder

_Desktop app only — not shown in the LAN UI._

Point EZPlayer at the folder that holds your show data.

- **Choose Show Folder** — pick an existing xLights show folder or a folder
  EZPlayer is already using. Switching folders reloads sequences, playlists,
  schedule, and layout from the new location.
- **Download Cloud Show** — pick an empty folder to start a fresh cloud-managed
  show. If the folder already has cloud configuration, EZPlayer opens it as-is.
  For a new folder, go to the **Cloud** screen to register the player.

## UI

Customize the look and feel of EZPlayer on this device.

- **Theme** — choose from EZRGBTheme, PureLightTheme, or NebulaFighterTheme.
  Use the palette icon next to the dropdown to preview the theme's colors.
- **UI scale** _(desktop app only)_ — zoom the entire UI between 75% and 175%.
  Useful when demoing on a video call. Click **Reset** to return to 100%. In
  the browser LAN UI, use the browser's own zoom (Ctrl±) instead.
- **Always use orbit controls** — when enabled, the **3D Preview** uses orbit
  controls (better for trackpads and touch). When off, EZPlayer picks the
  control style based on your device.

## Viewer Control

Let viewers request songs during configured hours — either through
**Remote Falcon** or EZPlayer's built-in viewer control.

### Viewer Control Type

| Option                  | What it does                                                            |
| ----------------------- | ----------------------------------------------------------------------- |
| **Disabled**            | No viewer requests.                                                     |
| **Remote Falcon**       | Poll Remote Falcon for viewer requests. Requires a Remote Falcon token. |
| **EZPlayer (built-in)** | Use EZPlayer's own viewer-control integration.                          |

When Remote Falcon is selected, paste your **Remote Falcon Token** into the
field below the type dropdown.

![Remote Falcon show page](/img/remote-falcon-1.png)

During active viewer-control hours, the player uploads the current song to your
Remote Falcon show page and polls for new requests before switching songs.

### Schedule Configuration

When viewer control is enabled (Remote Falcon or EZPlayer), define one or more
**schedule entries** that control when viewers can request songs:

- **Days** — all days, weekends, weekdays, or a single day of the week.
- **Start / end time** — 24-hour format (`14:30`). End times can use extended
  hours (`25:00` = 1:00 AM the next day) for windows that cross midnight.
- **Playlist** — which playlist viewers can pick from during this window.

Add entries with **Add Schedule Entry**. Delete an entry with the trash icon.

If windows overlap, the **last entry in the list takes priority** (shown as
higher priority in the list).

## Jukebox

Control which songs appear on the **Jukebox** screen using tags on your
sequences.

- **Excluded Tags (Always Filtered Out)** — songs with any of these tags are
  hidden from the jukebox. The default tag `nojukebox` is always excluded; you
  can add more (type a tag and press Enter).
- **Included Tags (Optional Filter)** — when empty, all songs are allowed except
  excluded ones. When one or more tags are listed, only songs that match at
  least one included tag are shown.

Tag matching is case-insensitive.

## Audio

![Volume control](/img/volume-control.png)

### Volume Control

- **Default Volume** — the baseline output level (0–100%) used when no schedule
  override is active. Volume changes ramp gradually rather than jumping.
- **Volume Schedule Overrides** — time-bounded volume levels. Each override has
  days, a start/end time, and a volume percentage. Add overrides with **Add
  Volume Override**.

As with viewer control, overlapping overrides resolve with **last entry wins**.

### Audio Sync Adjust

Fine-tune how audio lines up with the light sequence. The slider runs from
**−100 ms** to **+100 ms**:

- Negative values play audio slightly **earlier**.
- Positive values play audio slightly **later**.

Use this if lights and sound are consistently ahead or behind each other on your
setup.

## Player

Runtime behavior for scheduled playback.

- **Background Sequence** — how background-schedule content is blended with the
  main (foreground) show:
    - **Overlay** — background pixels are layered on top of the foreground.
    - **Underlay** — background pixels sit beneath the foreground.

This pairs with **background** entries on the [Schedule](./quickstart.md#4-schedule-the-show)
screen.

## Cloud

_Opens the Player Cloud Registration dialog instead of an inline panel._

Use this tile to manage EZPlayer's connection to EZRGB Cloud. The same
registration flow appears on first launch and on the **Cloud** sidebar screen.

### Status

The header shows one of:

- **Player ID Registered** — cloud connection is active and the player is known
  to your EZRGB account.
- **Waiting for Registration** — scan the QR code or open the registration URL
  in a browser logged in to EZRGB.
- **Cloud Paused** — polling is suspended. Click **Resume Cloud** to continue;
  your URL and token are kept.

### Polling Schedule

Control when EZPlayer downloads new content from the cloud (sequences,
playlists, schedule, layout):

- **Always** — content polling runs continuously while cloud is enabled.
- **During scheduled times** — content polling runs only inside the **Allowed
  Windows** you define. Outside those windows, downloads are suspended.

Registration heartbeat polling **always runs** while cloud is enabled, even in
scheduled mode — this keeps the player visible to the cloud and responsive to
remote commands.

If you choose **During scheduled times** but define no windows, content polling
is suspended entirely.

Add windows with **Add Window** (days + start/end time, same day/time format as
viewer control).

### Advanced

Expand **Advanced** for infrequently changed options:

- **Cloud Service URL** — override the default EZRGB cloud endpoint (for
  staging or self-hosted installs).
- **Current Player ID** — read-only view of the token for this show folder.
  **Generate New** creates a fresh ID (requires re-registration). **Clear**
  removes the current ID.
- **Set a specific Player ID** — paste an existing token to reconnect this
  folder to a player already registered in the cloud.
- **Polling Interval** — how often the player checks in with the cloud:
    - **Registration** (default 5 seconds) — heartbeat and command pickup.
    - **Manifest** (default 300 seconds / 5 minutes) — sequence list, downloads,
      layout, playlists, and schedule sync.

## About, License, and Terms

The footer at the bottom of the Settings screen opens:

- **About EZPlayer** — player and cloud version numbers.
- **License** — open-source licenses for bundled components.
- **Terms** — EZRGB terms of service.

## Where to next

- [Quickstart (Local)](./quickstart.md) — set up a local show.
- [Quickstart (Cloud)](./quickstartcloud.md) — connect to EZRGB Cloud.
- [API Reference](../reference/api.md) — change settings programmatically.
