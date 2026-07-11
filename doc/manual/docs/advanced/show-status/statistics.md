---
sidebar_position: 3
title: Statistics
---

# Show Status — Statistics

On the [Show Status](./details.md) screen, the **Player Status** card has a
**Stats** button (EZPlayer only). Click it to open **Playback Statistics** — a
detailed look at how the player is performing while a show runs.

If the player has not reported any stats yet, the dialog shows _No playback
statistics available_.

![Playback statistics](/img/stats-1.png)

## What you'll see

The dialog groups numbers into a few areas:

### Performance

How busy the playback loop is — idle time, time spent sending data to
controllers, and time spent blending background effects.

### Frames

Counts of **sent**, **missed**, and **skipped** frames, plus timing numbers
like average send time and worst lag. Rising missed or skipped counts can mean
the player or network is struggling to keep up.

### Sequence and audio loading

How long the player spends reading and decompressing sequence files and decoding
audio.

### Prefetch caches

How much sequence and audio data is cached ahead of playback — cache usage,
fetch counts, hits/misses, and any load errors. Useful mainly when diagnosing
slow starts or cloud-show downloads.

![FSEQ prefetch and last error](/img/stats-2.png)

### Last error

If the player hit a recent error, it appears at the bottom of the dialog.

## Reset

Click **Reset** to clear the cumulative counters and start fresh — handy after
you fix a problem and want a clean baseline for the next run.

For the broader Show Status screen, see [Details](./details.md). For per-controller
health, see [Controllers](./controllers.md).
