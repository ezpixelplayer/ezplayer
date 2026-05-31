---
sidebar_position: 1
title: Overview
---

# Architecture Overview

At the highest level, a show flows in one direction — from EZPlayer, through
your controllers, out to the pixels.

![Simple signal path: EZPlayer to Controllers to Pixels](/diagrams/arch-simple.svg)

- **EZPlayer** plays your sequenced show data.
- **Controllers** receive that data and drive each channel.
- **Pixels / lights** display the result, frame by frame.

This same diagram appears in the end-user slide deck — it is compiled once from
`doc/assets/diagrams/arch-simple.d2` and shared by both.
