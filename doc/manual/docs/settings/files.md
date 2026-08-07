---
sidebar_position: 8
title: Files
---

# Files

<!-- SCREENSHOT: the file manager dialog — tree on the left with a folder
     expanded, details/preview pane on the right. Drop the file at
     doc/manual/static/img/files.png and the line below will pick it up. -->

![Files](/img/files.png)

Browses the **show folder on the machine running EZPlayer**, from the desktop
app, the LAN web UI, or the cloud player site. Useful for getting a file onto
the player without walking over to it — dropping in artwork, pulling a log off,
tidying up leftovers after a season.

## This tile only exists if you turned it on

As with [Shell](./shell.md), there is no switch in the UI. The Files tile
appears only after someone runs this on the player machine:

```bash
ezplayer files --show-folder "D:\Shows\MyShow" --password-file secret.txt
```

:::note
On Windows, run `ezplayer.cmd` (installed next to `EZPlayer.exe`) rather than
the `.exe` itself, and supply the password with `--password-file` — there is no
interactive prompt there. See the
[CLI reference](../reference/cli.md#remote-access-terminal-and-file-manager).
:::

Until then the endpoint refuses every connection. See
[Remote access](../reference/cli.md#remote-access-terminal-and-file-manager) in
the CLI reference for the full command and for `--clear`.

The file manager has its **own password**, separate from the shell's — you can
hand out file access without handing out a terminal.

## What you can do

- **Browse** the folder tree. Sizes and modified times are shown; folders load
  their contents only when you open them, so a big media folder costs nothing
  until you look inside.
- **Upload** one or many files — click **Upload**, or drag them onto the tree.
  They land in the folder shown next to "Into:", which follows whatever you have
  selected. Large files are sent in chunks with a progress bar.
- **Download** the selected file to your computer.
- **Rename** and **Delete** a single item from the buttons at the right of its
  own row. Delete asks for confirmation first. Rows for files xLights requires
  show these buttons greyed out.
- **Bulk actions** use the tick-boxes: check several items, then **Delete
  selected** or, to move them, click the destination folder and press **Move
  here**. The toolbar buttons only ever act on what is ticked; the row buttons
  only ever act on that row.
- **Preview** without downloading: images, audio (with a player), and text-ish
  files including JSON — which is pretty-printed — XML, CSV and logs. Other
  types just show their details.

## What it deliberately cannot do

- **It cannot leave the show folder.** Every path is resolved and checked
  against the show folder, including through symbolic links, so a link pointing
  elsewhere on the disk is refused rather than followed.
- **It cannot see `.ezplayer/`.** That is the player's own settings directory —
  it holds the remote-access password hashes and your cloud credentials — so it
  is hidden from listings and refused if asked for by name.
- **It will not touch `xlights_rgbeffects.xml` or `xlights_networks.xml`.**
  Those are xLights' own files and the show does not work without them; they are
  shown with a lock and cannot be renamed, moved, deleted or overwritten.
- **It will not silently overwrite** on rename or move — a name that is already
  taken is refused rather than clobbered.

Switching the player to a different show folder closes any open session, since
it was authorized against the previous show's password.
