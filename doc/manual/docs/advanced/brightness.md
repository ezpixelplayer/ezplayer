---
sidebar_position: 3
title: Brightness
---

# Brightness

:::note
Requires EZPlayer 0.7 or later.
:::

The brightness feature can be used to dim your lights without changing your
sequences or your controllers. Color temperature adjustment is also supported.
Like [Volume](./volume.md), it has a default level and a schedule
of overrides, and the player applies changed gradually.

- **Default Brightness** — the baseline level (0–100%) used when no override is
  active. 100% sends the sequence exactly as rendered.
- **Default Color Temperature** — a tint from **Warm** (2000 K) through
  **Neutral** (6500 K) to **Cool** (12000 K).  "Warm" dims blue and green; cool
  dims red. (No brightness levels are ever increased above what the sequence
  specifies.)
- **Brightness Schedule Overrides** — brightness for specific
  time windows, optionally with their own color temperature. Click **Add Brightness
  Override** to set the days, start/end time, and level; check **Also set
  color temperature** to apply tint during that time window. A window without a color
  temperature keeps the default one.

When two overrides cover the same time, the **last applicable entry wins**.
Each override appears in a list with its days, time range, level,
tint and priority. Use the pencil to edit an entry, the up and down arrows to
move it up or down on the priority list, or the bin to delete it.

Brightness applies to everything the player sends: foreground sequences, the background
sequence, and overlays. Previews show the dimmed result, so what you see on the
Show View is what the lights get.  The EZPlayer brightness does not affect
settings stored on your controllers; those are still applied afterward.

The player screen shows the live level next to the volume indicator,.

Brightness lives on the **Brightness** tile of the
[Settings](../settings/overview.md) screen.
