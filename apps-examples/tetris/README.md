# Tetris app

Tetris played on one of your matrices, controlled from phones. It is a port of the `overlay-tetris`
developer tool to the EZPlayer app runtime: the player starts `tetris.mjs`, phones open the app's page,
and their taps reach the game as app events. While a game runs the board is painted into an overlay
lease on the chosen model and the sound effects go to an audio bus; between games both are released so
the show has the matrix back. Plain Node (22+), no dependencies.

## Install

In the player, open the Apps tile and point it at this folder (the one holding `ezapp.json`).
The player creates an instance and gives it a token; nothing else to set up.

## Configure

Open the instance's settings page (the gear on the Apps tile). Pick the grid model to play on, the frame
rate (10 to 30), the audio bus for sound effects (`immediate` by default; leave blank for silence) and the
volume, then Save. Until a model is chosen the game reports "not configured" and will not start.

## Play

Open the instance page on a phone (LAN link or the cloud link, same page). Tap Start; the first player
to start owns the game until it ends. Left and right move, the rotate button rotates, the down arrow hard
drops; the Start button becomes Pause while you play. The best score is kept and shown on the page.
