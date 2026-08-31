---
sidebar_position: 3
title: Audio
---

# Audio

![Audio](/img/audio.png)

## Volume (primary output)

The desktop player’s **primary** audio output is chosen under **Settings → Audio →
Audio Device**:

- **Default** — system default output (first option)
- Then any **connected** devices (Speakers, Headset, …)

**Volume Control** and schedule overrides apply only to that primary device.

Volume levels and schedule overrides are also documented under
[Advanced → Volume](../advanced/volume.md).

## Additional Audio Devices

On the **desktop (Electron) app**, expand **Additional Audio Devices**. Each
**currently connected** output (except the primary) appears as one row — check it
to play there with its own volume and schedule. Disconnected devices are not shown.

Settings are stored in the show folder’s `playbackSettings.json` and are local to
the machine (not synced via cloud settings).

To listen on two wireless headsets at once on Windows 11, use **Quick Settings →
Shared Audio** (needs Bluetooth LE Audio on the PC and both accessories). For
app-level multi-output testing, prefer **wired/USB** devices, or one wired + one
Bluetooth.

## Loudness Normalization

If set, all songs added will have loudness normalization applied by default.
By normalizing audio, overall volume level will be consistent across songs, 
and audio will play well on FM radio, outdoor speakers, phones,
etc.

## Audio Sync Adjust

Fine-tune how audio lines up with the light sequence. The slider runs from
**−100 ms** to **+100 ms**:

- Negative values play audio slightly **earlier**.
- Positive values play audio slightly **later**.

Use this if lights and sound are consistently ahead or behind each other on your
setup.
