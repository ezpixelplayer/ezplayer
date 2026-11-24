# Audio Demo app

A sound board for the player's audio injection API, as an EZPlayer app. It makes five game-style
sounds (kick, snare, hat, zap, coin), uploads them once as clips to a lease on an audio bus, and plays
them when a phone asks. One button schedules a whole bar of drums on the player's clock; another
streams a short tune as timed PCM packets over UDP into a second bus, the way a program would feed
live audio into the show. The reply timings are shown on the page, so you can see how soon an
unscheduled sound starts on each bus. It is the `audio-inject-demo` developer script wrapped for the
app runtime. Plain Node (22+), no dependencies.

## Install

In the player, open the Apps tile and point it at this folder (the one holding `ezapp.json`).

## Configure

Open the instance's settings page (the gear on the Apps tile). Pick the bus for the sound effects
(`immediate` by default; a new name creates a bus with default settings), the volume, and the bus the
tune is streamed into (`main`, the show audio, by default; blank hides the Tune button). The app
re-reads its settings every few seconds: a new volume is applied to the open lease, a new bus reopens
it.

## Use from the phone

Open the instance page on a phone (LAN link or the cloud link, same page). Tap a sound to hear it;
the panel above the buttons says how long after the player took the call it started and the round
trip. **Drum bar** schedules eight steps a quarter second apart on the player's clock. **Tune** streams
about six seconds of melody to the tune bus. **Stop all** cuts every sound on the lease and the tune.
Each app instance accepts 20 taps a minute by default; raise the instance's events-per-minute on the
Apps tile for a busier board. Show inputs mapped to `kick`, `snare`, `hat`, `zap`, `coin`, `bar`,
`tune` or `stop` do the same as the buttons.
