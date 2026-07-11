---
sidebar_position: 1
title: Architecture
---

# Architecture

For contributors, the interesting detail is the **Koa server running in a worker
thread** inside the player. The Electron UI (and any other client) talks to the
player over a REST API; the playback engine drives the controllers.

![Developer architecture: Electron UI calls the Koa server over REST; the playback engine drives controllers and pixels](/diagrams/ezp-arch-dev.svg)

The REST surface is documented in full under
[REST Interface (HTTP API)](./api.md). Runtime and build-time configuration
via environment variables is listed in
[Environment Variables](./env-variables.md). This diagram is compiled from
`doc/assets/diagrams/ezp-arch-dev.d2` and is shared with the developer slide deck.
