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

### Setting up a Raspberry Pi listener

Any Linux computer with Python 3 and `aplay` will do; both come with Raspberry
Pi OS and with FPP.

1. Copy `scripts/audio-bus-listen.py` from the source tree to the Pi.
2. Find the sound card's name with `aplay -L`. Use its `plughw:` line, such as
   `plughw:CARD=S3,DEV=0` for a USB sound card.
3. Try it, with the player's address and web port:

    ```
    python3 audio-bus-listen.py http://192.168.1.20:3000 --device plughw:CARD=S3,DEV=0
    ```

    It prints `connected` once it reaches the player. Its name is the Pi's host
    name unless you give one with `--name`.

4. On this page, add a bus, turn **Play on this computer** off, set its lead to
   150 ms, and check the Pi under **Send to listeners**. Sound sent to that bus
   now plays on the Pi.

To start it whenever the Pi starts, save this as
`/etc/systemd/system/ezplayer-audio-listener.service`, with your own user, path,
address and device:

```
[Unit]
Description=EZPlayer audio listener
After=network-online.target sound.target
Wants=network-online.target

[Service]
User=pi
ExecStart=/usr/bin/python3 -u /home/pi/audio-bus-listen.py http://192.168.1.20:3000 --device plughw:CARD=S3,DEV=0
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then run `sudo systemctl enable --now ezplayer-audio-listener`. Its messages are
in `journalctl -u ezplayer-audio-listener`. It keeps trying while the player is
off, so the two can start in either order.

Things to know:

- The Pi's clock does not have to be right; the listener follows the player's.
- If the sound is late against the lights, raise `--delay` (60 ms by default):
  it is how long the Pi's sound card takes to make a sample heard.
- Every few seconds of use the listener prints how many pieces arrived late. If
  any did, raise the bus's lead.
- Only one program can use a sound card at a time. On a Pi that also runs FPP,
  give the listener a card FPP does not play through.
