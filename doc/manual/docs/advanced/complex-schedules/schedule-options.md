---
sidebar_position: 3
title: Schedule Options
---

# Schedule Options

A [simple schedule](../../basics/simple-schedules.md) just needs a playlist and a
time window. When you open a schedule entry, a few extra options let you control
exactly how it behaves. As there are many settings, it is recommended to use the
[Schedule Preview](./schedule-preview.md) feature to make sure they will behave as
expected.

![Schedule options](/img/schedule-timings.png)

The schedule plays:
1. The intro playlist (if any)
2. The main playlist, applying loop / shuffle to fill time, if so requested
3. The outro playlist (if any)

## Filling the time window

- **Loop** — replay the main playlist until the window's end time.
- **Shuffle** — play the main playlist in a random order.

You can pick **one** of these, not both — turning on one turns off the other.

## End Time Behavior

When doing a loop/shuffle, or if the time slot is too short to accommodate the full
intro, main, and outro playlists, the main playlist is adjusted to fit the scheduled
time window.  However, a window rarely lines up perfectly with the end of a song.

While playing the main playlist, at the end of each song the player evaluates whether
there is enough time for another song, taking into account any outro playlist.

 **End Time Behavior** decides what happens when there is not time for exactly one more song:

| Option                                  | What it does                                            |
| --------------------------------------- | ------------------------------------------------------- |
| **End Between Items, Before End Time**   | Do not take another song, always stop on or before the end time |
| **End Between Items, After End Time**    | Take another song, always stop on or after the end time |
| **End Between Items, Closest To End Time** | Play another song if the amount of time left is at least half its length, schedule may therefore end "half a song" before or after the end time |
| **Hard Cutoff At End Time**             | Stop exactly at the end time, even mid-song (abruptly) |

## Priority and overlaps

When two schedules overlap in time, **Priority** (Low, Normal, High) decides which one
plays. If a higher-priority window takes over, the lower-priority one pauses
and resumes afterward.

Two checkboxes fine-tune whether one schedule interrupts the other between songs, or immediately:

- **Interrupt Other Schedules Immediately** — high-priority schedule cuts in right away
  instead of waiting for the current song to finish.
- **Other Schedules Interrupt Immediately** — causes a higher-priority entry to
  cut into *this* one right away.  (Useful for animation schedules, rather than songs.)

A further checkbox controls whether the interrupted sequence keeps "playing", or pauses while interrupted:
- **Keep To Schedule When Interrupted** — after being interrupted, pick back up
  where the clock is now rather than where it left off.
