# Tag the Monsters app

A player walks the yard with a wand. Its flashlight beam lands on every pixel in its path, across
the whole display, while monsters and friends run across the matrices you choose. Hold the beam on a
monster long enough to tag it; light up a friend and lose points. Rounds are timed, the score is on the
app's page, and the holder, the wand and the beam show in the Show View. Plain Node (22+), no
dependencies.

The beam is one **pattern lease** over an xLights model group: the app sends the player a preset
(`beam`) and, twenty times a second, a hundred bytes of uniforms (where the wand is, where it
points, whether it is on). The player colors every node itself, on the GPU when it has one, so a
373,000-node layout costs it about half a millisecond a frame and the network nothing to speak of.
The sprites are RGBA grid leases blended `over` the show, so the matrices keep playing their sequence
under the monsters, tinted by role. Nothing here is specific to the simulator: the real RF wand and
base stations replace it with one row on the Apps card.

## Install

In the player, open the Apps tile and point it at this folder (the one holding `ezapp.json`). Do
the same for `../wand-sim` until the real wand arrives. The settings page reads the layout from the
player, so the groups and matrices are there to pick whether or not the game is running; its first line
says what the player and the game are doing, including when the last wand pose arrived.

## Wire the wand

Open the Wand Simulator's page and move the wand once. Then, on the Apps card under **Show inputs**,
`wand-sim/pose` appears under *Heard lately*; **Map this** fills the row, pick this instance and its
`pose` input, and add it. (The source is whatever the Wand Simulator's settings say, `wand-sim` by
default.) A base station does the same thing by posting to the same address:

```
POST http://<player>:3000/api/ezp/inputs/<source>/pose
{ "value": { "x": 1.2, "z": 3.4, "yaw": -15, "pitch": 12, "on": true } }
```

`x` and `z` are meters in the wand frame (x to the right, z toward the holder's back), `yaw` and
`pitch` are degrees (yaw 0 faces the display, pitch up), `on` says the beam is lit. A pose older than
two and a half seconds switches the beam off.

## Configure

Open the instance's settings page (the gear on the Apps tile).

- **Season**: the Halloween cast (ghosts, witches and goblins to tag; pumpkins, kids and candy to
  spare) or the Christmas cast (Krampus, gremlins and a yeti; Santa, reindeer, elves and gingerbread).
- **Beam coverage**: an xLights model group the beam may land on, or a list of models. A group of
  everything except the sprite matrices works well. Half angle, rim softness, range, color,
  cloudiness and blend shape the beam; `add` is light, `max` never darkens, `over` paints.
- **Sprite matrices**: the grid models the cast runs across; each gets an exclusive lease during a
  round. The background colors tint a matrix by the role of whoever is on it, at the alpha given, so
  the show underneath still shows.
- **Wand calibration**: where the wand frame's origin sits in the layout (blank: in front of the
  layout's middle, on the ground), a heading offset, world units per meter (100 when the layout was
  drawn in centimeters), and the holder's eye height. Changes apply at once.
- **Rules**: round length, how long the beam must stay on a creature, what share of its lit pixels
  must be inside the cone, points and penalty, and the pause before the next creature.
- **Delivery**: beam uniforms and sprite frames over UDP (default) or HTTP `PUT`; start a round when
  the app starts.

## Play

Start a round from the page, or from a mapped `start` input. The page shows the score, the time
left, how many monsters were tagged and friends lit, whether the beam is on, and for each matrix who
is running across it and how much of them is in the beam. Stop ends the round early; a finished round
leaves its result on the page until the next one starts. Between rounds every lease and scene object
is released, so the show owns the lights again.

## Status

Published with every change and at least twice a second:

```json
{
  "phase": "playing", "cast": "halloween", "score": 40, "tags": 4, "misses": 1, "timeLeft": 61,
  "beam": { "on": true, "fresh": true, "lease": { "id": 12, "nodes": 352190, "backend": "gpu", "group": "Beam Coverage" } },
  "pose": { "x": 0.4, "z": 2.1, "yaw": -12, "pitch": 8, "on": true, "ageMs": 31 },
  "wand": { "origin": [124, 160, 1089], "dir": [-0.21, 0.14, -0.97] },
  "sprites": [{ "model": "Matrix", "size": "64x32", "creature": "ghost", "role": "foe", "x": 17, "lit": 72, "dwell": 210 }],
  "groups": [{ "name": "Beam Coverage", "models": 598 }], "gridModels": [{ "model": "Matrix", "width": 64, "height": 32, "type": "Matrix" }]
}
```

`beam.lease.backend` says where the player evaluates the beam: `gpu` through the xlgl addon, `js` on
the CPU. `groups` and `gridModels` feed the settings page's pick lists.

## How the pieces fit

- `POST /api/ezp/overlays` with `{ mode: "layer", group, blend, pattern: { preset: "beam", uniforms } }`
  opens the beam; a JSON object of uniforms is its payload, sent as overlay packets or a `PUT`.
- `POST /api/ezp/overlays` with `{ mode: "exclusive", model, format: "grid", channels: 4, blend: "over" }`
  opens a sprite matrix; its payload is RGBA rows, top first.
- The hit test is geometry in the app: the world coordinates of a matrix's nodes come from
  `GET /api/ezp/overlays/targets?model=NAME&detail=nodes`, and a creature counts as lit when enough of
  its pixels sit inside the cone.
- The holder and the beam are scene objects under `/api/ezp/objects`, patched as the wand moves.
