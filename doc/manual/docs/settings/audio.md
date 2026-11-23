---
sidebar_position: 3
title: Audio
---

# Audio

![Audio](/img/audio.png)

## Audio Output

**Use default audio output?** chooses how the desktop player reaches your speakers.

- **Yes** plays through whatever the operating system's default output is at the
  time. Change the default in the OS and the player follows. **Volume Control**
  applies to this output.
- **No** plays only through the devices you check under **Audio Devices**. Each
  device has its own volume and volume schedule.  This allows, for example,
  sending audio straight to the FM transmitter, applying a volume schedule to the
  patio speakers, and not sending any audio to the USB headset.

Checked devices stay selected while unplugged (they show as **Not connected**) and
resume automatically when they return. Select a device while it is connected.

## Volume

Volume levels and schedule overrides are documented under
[Advanced → Volume](../advanced/volume.md).

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

## Audio Buses

Other programs can send sound to the player: a game that makes sound effects,
or a prop that talks. Each **bus** is a place that sound can go. The programs
use the [audio injection API](../reference/api.md#audio-injection-apiezpaudiobuses-apiezpaudioleases).

- **main** is the show audio. Sound sent to it is mixed with the song, plays at
  the show volume, and is heard by listeners. It is not listed here because it
  has nothing to set.
- **immediate** plays on the show's speakers with a short delay, for sounds that
  must follow an event at once. Listeners do not hear it.
- Any other bus is one you added, or one a program asked for by name. A bus that
  a program asks for by a new name is added to this list.

Each bus has:

- **Volume**. On the show's speakers it is applied on top of the show volume.
- **Lead**: how far ahead of its play time sound is handed to the speakers. A
  shorter lead plays sooner, but leaves less time to deliver each piece, and
  pieces that arrive late are cut short. 40 ms is about the least that works on
  a busy player.
- **Chunk**: the length of the pieces the sound is cut into.
- **Play on this computer**. Turn it off for a bus that only another computer
  plays.
- A checkbox for each sound device on this computer. With none checked the bus
  plays on the show's outputs. Check devices to play on those instead, such as
  a small speaker behind a prop.
- **Send to listeners**: a checkbox for each listener, once any has connected.

A **listener** is a small program on another computer, next to a speaker: a
Raspberry Pi behind a prop, say. It connects to the player under a name, and
from then on that name can be checked on any bus. `scripts/audio-bus-listen.py`
in the source tree is one; it needs only Python 3 and a sound card. Give a bus
that goes to a listener a lead of 150 ms or so, to cover the network. The
listeners are listed below the buses, each with a trash can that forgets it;
it is listed again the next time it connects.

The trash can removes a bus and ends whatever is playing on it. The reset arrow
puts **immediate** back to its defaults.
