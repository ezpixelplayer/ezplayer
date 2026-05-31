---
sidebar_position: 2
title: Developer View
---

# Developer View

For contributors, the interesting detail is the **Koa server running in a worker
thread** inside the player. The Electron UI (and any other client) talks to the
player over a REST API; the playback engine drives the controllers.

![Developer architecture: Electron UI calls the Koa server over REST; the playback engine drives controllers and pixels](/diagrams/ezp-arch-dev.svg)

The REST surface is documented in full under
[Reference → API](../reference/api.md). This diagram is compiled from
`doc/assets/diagrams/ezp-arch-dev.d2` and is shared with the developer slide deck.
