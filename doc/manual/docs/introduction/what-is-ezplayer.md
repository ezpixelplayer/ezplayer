---
sidebar_position: 1
slug: /
title: What is EZPlayer
---

# What is EZPlayer

EZPlayer "runs" your light show. By "runs", we mean it organizes a set of songs/sequences into a scheduled show, inserts announcements, allows viewers to see the schedule and make selections, monitors your show to make sure it is healthy, and so on.

This manual covers the basics and advanced features, but also how the puzzle fits together and some of the technical details.

## How a show reaches your lights

At the highest level, a show flows in one direction — from EZPlayer, through
your controllers, out to the pixels.

![Simple signal path: EZPlayer to Controllers to Pixels](/diagrams/arch-simple.svg)

- **EZPlayer** plays your sequenced show on demand, or on a schedule.
- **Controllers** receive that network data and drive the light strings.
- **Pixels / lights** display the result.

## Where to go next

- **[Getting Started (Local)](../basics/getting-started-local.md)** — point EZPlayer
  at a show folder and have it running in a few minutes.
- **[Getting Started (Cloud)](../basics/getting-started-cloud.md)** — register
  EZPlayer and let the cloud do the rest.
- **[Programmer Reference](../reference/architecture.md)** — architecture, the CLI,
  and the HTTP API.
