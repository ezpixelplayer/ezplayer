---
sidebar_position: 1
title: Show Folder
---

# Show Folder

![Show Folder](/img/show-folder.png)

_Desktop app only for choosing the show folder — not shown in the LAN UI._

Point EZPlayer at the folder that holds your show data.

- **Choose Show Folder** — pick an existing xLights show folder or a folder
  EZPlayer is already using. Switching folders reloads sequences, playlists,
  schedule, and layout from the new location.
- **Download Cloud Show** — pick an empty folder to start a fresh cloud-managed
  show. If the folder already has cloud configuration, EZPlayer opens it as-is.
  For a new folder, go to the **Cloud** screen to register the player.

## Media Folder

Optional extra directory searched for companion audio (and related media) when
adding a song or running [Bulk Import](../basics/songs.md#bulk-import).

Use this when your `.mp3` files live outside the show folder — for example a
shared media library or an xLights render output folder.

### Desktop app

1. Open **Settings → Show Folder**.
2. Click **Choose Media Folder** and select the directory on this PC.
3. Use **Clear** to stop searching that location.

### LAN UI

Browsers cannot select a path on the player disk. For missing audio during
[Bulk Import](../basics/songs.md#bulk-import):

1. In the Bulk Import Summary, click **Choose Media Folder**.
2. Pick a folder **on the device running the LAN UI** that contains the matching
   MP3 files.
3. Those files are uploaded to the player and the failed sequences are
   **retried automatically**.

To set a **permanent** media folder path on the player, use the desktop app
(**Settings → Show Folder**). The LAN **Settings → Media Folder** page shows the
current path (if any) and can clear it.

### Search order

1. Next to the `.fseq` (same folder as the sequence)
2. The **Media Folder** (if set)
3. The show folder (for single **Add Song** auto-detect)

Bulk import requires an exact audio basename match and will not use unrelated
MP3s already sitting in the show folder unless they were part of the same LAN
upload selection or found via the Media Folder / colocated folder.
