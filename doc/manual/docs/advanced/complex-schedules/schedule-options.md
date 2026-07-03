---
sidebar_position: 3
title: Schedule Options
---

# Schedule Options

A [simple schedule](../../basics/simple-schedules.md) just needs a playlist and a
time window. When you open a schedule entry, a few extra options let you control
exactly how it behaves. [Schedule Preview](./schedule-preview.md) uses these same
settings when it simulates your show.

![Schedule options](/img/schedule-timings.png)

## Filling the time window

- **Loop** — replay the main playlist until the window's end time.
- **Shuffle** — play the main playlist in a random order.

You can pick **one** of these, not both — turning on one turns off the other.

## End Time Behavior

A window rarely lines up perfectly with the end of a song. **End Time Behavior**
decides what happens when the end time arrives mid-song:

| Option                                  | What it does                                            |
| --------------------------------------- | ------------------------------------------------------- |
| **End Between Items, Before End Time**   | Finish the current song early, stopping before the end time |
| **End Between Items, After End Time**    | Let the current song finish, even slightly past the end time |
| **End Between Items, Closest To End Time** | Whichever of the two is nearer to the end time         |
| **Hard Cutoff At End Time**             | Stop exactly at the end time, even mid-song             |

## Priority and overlaps

When two windows overlap, **Priority** (Low, Normal, High) decides which one
plays. The higher-priority window takes over, and the lower-priority one pauses
and resumes afterward.

Three checkboxes fine-tune the handoff:

- **Interrupt Other Schedules Immediately** — this entry cuts in right away
  instead of waiting for the current song to finish.
- **Other Schedules Interrupt Immediately** — allow a higher-priority entry to
  cut into *this* one right away.
- **Keep To Schedule When Interrupted** — after being interrupted, pick back up
  where the clock is now rather than where it left off.

Leave these off unless you have a specific reason to change them.
