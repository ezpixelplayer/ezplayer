---
sidebar_position: 3
title: Brightness
---

# Brightness

Brightness dims every light on the way out of the player, without changing your
sequences or your controllers. Use it to take the edge off a display that is too
bright for the street after a certain hour, or to warm the whole show up on a
cold-looking night. Like [Volume](./volume.md), it has a default and a schedule
of overrides on top of it, and the player eases toward the target over about a
second rather than jumping.

- **Default Brightness** — the baseline level (0–100%) used when no override is
  active. 100% sends the sequence exactly as rendered.
- **Default Colour Temperature** — a tint from **Warm** (2000 K) through
  **Neutral** (6500 K) to **Cool** (12000 K). Warm dims blue and green so the
  display leans amber; cool dims red so it leans blue. Nothing is ever boosted,
  so at neutral the colours are untouched and at 100% brightness a white pixel
  is still as bright as the sequence asked for.
- **Brightness Schedule Overrides** — time-bounded brightness for specific
  times, optionally with their own colour temperature. Click **Add Brightness
  Override** to set the days, start/end time and level; turn on **Also set
  colour temperature** to tint during that window. A window without a colour
  temperature keeps the default one.

When two overrides cover the same time, the **last entry wins** (the same way
[Volume](./volume.md) and [Viewer Control](./viewer-control.md) resolve
overlaps). Each override appears in a list with its days, time range, level,
tint and priority. Use the pencil to edit an entry, the up and down arrows to
lower or raise its priority (entries lower in the list take priority), or the
bin to delete it.

Brightness applies to everything the player sends: sequences, the background
sequence, and overlays. Previews show the dimmed result, so what you see on the
Show View is what the lights get. It does not touch the brightness or gamma
settings stored on your controllers; those still apply on top, as they always
did.

The player screen shows the live level next to the volume meter, and the
[`/api/ezp/brightness`](../reference/api.md#get-apiezpbrightness) endpoints and
the `setbrightness` player command read and write the same settings.

Brightness lives on the **Brightness** tile of the
[Settings](../settings/overview.md) screen.
