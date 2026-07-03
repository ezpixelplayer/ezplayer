---
sidebar_position: 2
title: Background Schedule
---

# Background Schedule

Most show content lives on the **Main** schedule — this is what drives your
foreground lights and audio. A **Background** schedule runs a second playlist at
the same time, layered together with the main show. Use it for always-on
elements such as tune-to loops or ambient effects.

![Background schedule](/img/background-schedule.png)

## Creating one

In the [schedule editor](../../basics/simple-schedules.md), use the **Main /
Background** toggle at the top to switch to a background entry. A background entry
has the same options as a main one — time window, intro/outro, loop or shuffle,
priority, and [end-time behavior](./schedule-options.md).

The key difference is that a background schedule never replaces the foreground
show. It always plays *alongside* main, layered over or under it.

## Overlay vs Underlay

A single **blend mode** decides how background content combines with the
foreground for the whole player:

- **Overlay** — background pixels sit on top of the foreground.
- **Underlay** — background pixels sit beneath the foreground.

You set this with the **Background Sequence** option on the **Player** tile of
the [Settings](../../settings/overview.md) screen.
