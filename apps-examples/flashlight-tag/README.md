# Flashlight Tag app

A little game that plays itself in the Show View: two stick figures chase each other with flashlights
around some trees while ghosts chase them both. Whoever is "it" has the lit flashlight; catching the
other in the beam swaps roles, and a ghost caught in the beam is stunned. It is the
`scene-flashlight-tag` developer script wrapped as an EZPlayer app: the figures, trees, beams and
effects are scene objects on short leases, the sound effects go to an audio bus, and both are released
when the game stops. Plain Node (22+), no dependencies.

## Install

In the player, open the Apps tile and point it at this folder (the one holding `ezapp.json`).

## Configure

Open the instance's settings page (the gear on the Apps tile). Pick the plane: **ground** puts the
field in front of the layout, which looks best in 3D; **wall** puts it on the X/Y plane over the
layout, which looks best in 2D. Leave the center, field width and figure height blank and they are
fitted to the layout from the model coordinates; fill them in to place the field by hand. Choose the
audio bus for the sound effects (`immediate` by default, blank for none) and the volume. Tick
**Start the game as soon as the app starts** for a show that should run it without anyone tapping.
Settings are re-read between games, so a change takes effect on the next Start.

## Use from the phone

Open the instance page on a phone (LAN link or the cloud link, same page). Tap **Start** and the
chase begins in the Show View; the page shows the tag count, who is it, a top-down map of the field
with the beam, the ghosts and the trees, and how long the game has run. Tap **Stop** to clear the
field and give the Show View back. Anyone with the page may start or stop; a show input mapped to
`start` or `stop` does the same.
