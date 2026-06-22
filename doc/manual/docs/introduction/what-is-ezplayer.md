---
sidebar_position: 1
slug: /
title: What is EZPlayer
---

# What is EZPlayer

EZPlayer runs your light show. This manual covers the basics, but also how the
puzzle fits together and tech details.

## How a show reaches your lights

At the highest level, a show flows in one direction — from EZPlayer, through
your controllers, out to the pixels.

![Simple signal path: EZPlayer to Controllers to Pixels](/diagrams/arch-simple.svg)

- **EZPlayer** plays your sequenced show data.
- **Controllers** receive that data and drive each channel.
- **Pixels / lights** display the result, frame by frame.

## Where to go next

- **[Getting Started (Local)](../basics/getting-started-local.md)** — point EZPlayer
  at a show folder and have it running in a few minutes.
- **[Getting Started (Cloud)](../basics/getting-started-cloud.md)** — register
  EZPlayer and let the cloud do the rest.
- **[Programmer Reference](../reference/architecture.md)** — architecture, the CLI,
  and the HTTP API.
