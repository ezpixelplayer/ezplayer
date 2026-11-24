# Scene Objects Demo app

The smallest useful scene objects client, as an EZPlayer app. It puts three display-only objects into
the Show View and animates them: a beam that sweeps and changes color, a cloud of 400 sparkles that
breathes, and an orange sphere with a white box riding on it that orbits the center. It is the
`scene-objects-demo` developer script wrapped for the app runtime: the objects sit on three-second
leases, so they vanish on their own when the app stops. Plain Node (22+), no dependencies.

## Install

In the player, open the Apps tile and point it at this folder (the one holding `ezapp.json`).

## Configure

Open the instance's settings page (the gear on the Apps tile). The center X and Y and the size are
xLights world units; leave any of them blank and the app fits that one to the layout from the model
coordinates (the middle of the layout, its bottom edge, its width). Tick **Start as soon as the app
starts** to run without anyone tapping. Settings are re-read while the demo is stopped, so a change
takes effect on the next Start.

## Use from the phone

Open the instance page on a phone (LAN link or the cloud link, same page). Tap **Start** and the
objects appear in the Show View; the page shows how long they have run, how many updates were sent,
how many times a lost lease was recreated, and what each object is doing now (the beam's color, the
sparkles' opacity, the orbiter's angle). Tap **Stop** to remove them. A show input mapped to `start` or
`stop` does the same.
