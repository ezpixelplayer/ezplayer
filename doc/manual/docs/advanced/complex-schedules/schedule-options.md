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

![Schedule options](/img/schedule-timings-1.png)
![Advanced Options](/img/schedule-timings-2.png)

The schedule plays:

1. The intro (if any)
2. The main playlist, applying loop / shuffle to fill time, if so requested
3. The outro (if any)

The **Intro** and **Outro** can each be a playlist or a single song. Type in the box to
search; playlists are listed first, then songs.

## Filling the time window

- **Loop** — replay the main playlist until the window's end time.
- **Shuffle** — play the main playlist in a random order.

You can pick **one** of these, not both — turning on one turns off the other.

If you set a **To** time longer than the main playlist (plus intro/outro), **Loop**
is enabled automatically so the window stays filled. A short warning appears when
that happens. If you clear both Loop and Shuffle while the playlist is still too
short, the editor warns that the playlist will not fill the whole schedule.

## Start every

With **Loop** or **Shuffle** on, the playlist normally starts again the moment it
finishes. Enter a number of minutes in **Start every** to start it on a fixed spacing
instead: with a 10-minute playlist and "start every 15 minutes", the playlist plays
at :00, :15, :30 and :45, with 5 minutes between.

- Start times are counted from the schedule's **From** time.
- The intro and outro play at every start.
- Nothing from this schedule plays in the gaps. A lower-priority schedule covering
  the same window plays there, and gives way again at the next start.
- A start can be late if something else is playing (a request, or a higher-priority
  schedule). The starts after it are back on the original times.
- If a start time arrives while the playlist is still playing, that start is skipped.
  The editor warns when the playlist is longer than the spacing.
- With **Shuffle**, each start plays every song once, in a new order.
- If the player starts up, or the schedule is changed, part way through the window,
  it waits for the next start time. Changes to a schedule that is playing apply from
  the next start.

## Interstitial

An **Interstitial** is a playlist or single song (an announcement, a station ID, a
"tune to 88.1" reminder) played between songs of the main playlist.

- **Every (songs)** — how many songs play between interstitials.
- **First after song** — how many songs play before the first one. Leave it empty to
  use the same number as **Every**; enter 0 to play one before the first song.

For example, _Every 3, First after song 1_ plays: song 1, interstitial, songs 2–4,
interstitial, songs 5–7, interstitial, and so on.

The count carries on when a looped playlist wraps around, and begins again at each
**Start every** start. An interstitial is never the last thing before the outro or
the end of the schedule: when there is not room for both it and the song after it, the
interstitial is left out.
(With **Finish exactly at end time**, it can be cut off like any song.)

## End Time Behavior

When doing a loop/shuffle, or if the time slot is too short to accommodate the full
intro, main, and outro playlists, the main playlist is adjusted to fit the scheduled
time window. However, a window rarely lines up perfectly with the end of a song.

While playing the main playlist, at the end of each song the player evaluates whether
there is enough time for another song, taking into account any outro playlist.

**End Time Behavior** decides what happens when there is not time for exactly one more song:

| Option                                                      | What it does                                                                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Finish before end time, between songs**                   | Do not take another song; always stop on or before the end time. Use when the show must be over by a promised time.    |
| **Finish after end time, between songs**                    | Take another song; always stop on or after the end time. Use when the show should still be playing at a promised time. |
| **Finish near end time, between songs**                     | Play another song if at least half of it fits; the schedule may end roughly half a song before or after the end time.  |
| **Finish exactly at end time, even if a song gets cut off** | Stop exactly at the end time, even mid-song (abruptly).                                                                |

## Advanced Options

Priority and interrupt settings live under the collapsible **Advanced Options**
section in the schedule editor.

### Priority and overlaps

When two schedules overlap in time, **Priority** (Low, Normal, High) decides which one
plays. If a higher-priority window takes over, the lower-priority one pauses
and resumes afterward.

Two checkboxes fine-tune whether one schedule interrupts the other between songs, or immediately:

- **Interrupt Other Schedules Immediately** — high-priority schedule cuts in right away
  instead of waiting for the current song to finish.
- **Other Schedules Interrupt Immediately** — causes a higher-priority entry to
  cut into _this_ one right away. (Useful for animation schedules, rather than songs.)

A further checkbox controls whether the interrupted sequence keeps "playing", or pauses while interrupted:

- **Keep To Schedule When Interrupted** — after being interrupted, pick back up
  where the clock is now rather than where it left off.
