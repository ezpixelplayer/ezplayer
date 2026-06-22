---
sidebar_position: 1
title: Complex Schedules
---

# Complex Schedules

Once you have the [basics](../../basics/simple-schedules.md) down, the scheduler
has more to offer: background layers, precise runtime behavior, and manual
overrides.

## What happens at runtime

When the clock enters a scheduled window, EZPlayer:

1. **Loads the entry** into its scheduler (it looks ahead several hours so
   upcoming shows are ready in advance).
2. **Plays the intro playlist** from start to finish (if configured).
3. **Plays the main playlist** — in order, or shuffled/looped if you enabled
   those options.
4. **Transitions to the outro** as the window nears its end time, governed by
   the **end policy**:
   - **Stop at sequence boundary (early)** — end before the last song if time
     is running out.
   - **Stop at sequence boundary (late)** — allow the current song to finish
     even slightly past the window.
   - **Stop at nearest boundary** — compromise between early and late.
   - **Hard cut** — stop exactly at the end time, even mid-sequence.
5. **Plays the outro playlist** (if configured), then the entry is done.

**Priority** resolves overlaps. If two main-schedule windows collide, the
higher-priority entry takes over. Lower-priority entries are suspended and can
resume when the winner finishes — unless you chose **hard cut in**, which
interrupts immediately.

**Loop** replays the main playlist until the window ends. **Shuffle** builds a
randomized main playlist (seeded from the schedule start time so it is
repeatable) long enough to fill the window.

## Overrides and manual control

The schedule is the default autopilot, but you are not locked in:

- **Jukebox** — queue a song or playlist on demand. Queued items play at the
  next sequence boundary unless marked immediate.
- **Stop** — graceful stop finishes the current song (and outro, if any); stop
  now cuts immediately.
- **Skip** — advance to the next song in the current playlist.
- **Viewer control** — integrations such as Remote Falcon can request songs
  during configured viewer-control hours.

Interactive requests use a separate priority tier from scheduled entries, so a
scheduled show can be suspended and later resumed.
