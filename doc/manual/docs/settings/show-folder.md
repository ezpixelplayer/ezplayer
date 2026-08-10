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

Browsers cannot browse the player's disk, so **Settings → Media Folder** in the
LAN UI is a text field: type the folder path **as the player PC sees it**
(for example `C:\Shows\Media`) and click **Save**, or **Clear** to stop
searching that location.

### Search order

1. Next to the `.fseq` (same folder as the sequence)
2. Subdirectories beneath the sequence's folder
3. The **Media Folder** (if set), then its subdirectories

Bulk import requires an exact audio basename match (from the FSEQ header or
the FSEQ basename) wherever the audio is found. Well-known non-media
directories (`.git`, `.ezplayer`, recycle bins, and similar) are skipped
during the subdirectory walks.
