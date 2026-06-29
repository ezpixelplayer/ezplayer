---
sidebar_position: 9
title: 2D/3D Preview
---

# 2D/3D Preview

The **Preview** screen renders your show **live** on a virtual copy of your
display. As [songs](./songs.md) play — from the [jukebox](./jukebox.md), a
[schedule](./simple-schedules.md), or an API request — the pixels light up here
exactly as they do on your real props. It is the quickest way to check that a
sequence looks right without standing outside.

![3D Preview](/img/3D-preview.png)

## 3D vs 2D

Use the **View** toggle in the top-left to switch between two ways of looking at
the same layout:

| Mode   | What it shows                                                              |
| ------ | ------------------------------------------------------------------------- |
| **3D** | Your models placed in space, so you can fly around and see depth and angles |
| **2D** | A flat, face-on view — useful for a clean, head-on look at the display     |

Each mode remembers its own camera position, so you can set up a 3D angle and a
2D framing independently and flip between them.

## Choosing what to preview

The **Preview** dropdown controls which models are shown:

- **Default** — the standard preview for your show.
- **All Models** — every model in the layout.
- **Layout groups** — if your show defines preview groups, each one appears here
  so you can focus on a single area (for example, just the roofline or a mega
  tree).

## Moving the camera

### 3D view

- **Left drag** — look around
- **Right drag** — orbit the show
- **Middle drag** — strafe / pan
- **Scroll** — move forward and back
- **Keyboard** — `W`/`S` move, `A`/`D` turn, `Z`/`C` strafe, `Q`/`E` down/up

If you prefer simpler orbit-style controls (handy on a trackpad or touchscreen),
turn on **Always use orbit controls** in [UI settings](../settings/ui.md).

If your show was designed with saved camera **viewpoints**, a camera icon appears
in 3D mode — click it to jump to one of those saved angles.

### 2D view

- **Left drag** or **Middle drag** — pan
- **Right drag** or **Scroll** — zoom

## Settings

Click the gear icon to open **Preview Settings**:

- **Pixel Size** — make the pixels larger or smaller so the preview reads well at
  any zoom level.
- **Brightness** — scale how bright the preview looks (this only affects the
  preview, not your real output).
- **Reset View** — re-fit the camera so the whole layout is in frame again.
- **Set as Default View** — remember the current camera angle, view mode, and
  slider settings as the starting point next time.

## Model library

Click the list icon on the right to open the **Model Library**. From here you can
search for a model by name and click it to highlight it in the preview — useful
for finding a specific prop in a busy layout. Click it again to clear the
highlight.

## Audio in the LAN UI

When you open the Preview from the [LAN UI](./local-web-interface.md) in a
browser, an audio button lets you listen to the show's music alongside the
visuals. (On the desktop app, audio plays through your normal output instead.)

:::note
The Preview is a visual aid. It shows what the sequence sends to your models;
it does not control playback. Start, pause, or stop the show from the
[Player screen](./player-screen.md) or the [jukebox](./jukebox.md).
:::
