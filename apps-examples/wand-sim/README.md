# Wand Simulator app

Stands in for the RF wand and its base stations while they are being built. The page is a joystick
that walks the holder around the yard, a dome that aims the wand, and a button for the beam. Every
pose goes to the player's **show inputs**, exactly the call a base station will make, and the Apps
card's mapping table routes it to the game. Plain Node (22+), no dependencies.

```
POST http://<player>:3000/api/ezp/inputs/<source>/pose
{ "value": { "x": 1.2, "z": 3.4, "yaw": -15, "pitch": 12, "on": true } }
```

- `x`, `z`: meters in the wand frame, x to the right, z toward the holder's back.
- `yaw`, `pitch`: degrees; yaw 0 faces the display, pitch up.
- `on`: the beam is lit.

## Install

In the player, open the Apps tile and point it at this folder. Then, on the Apps card under **Show
inputs**, add a row: source `wand-sim`, name `pose`, driving the Tag the Monsters instance's `pose`
input. The page's header says whether the last pose reached an app.

## Use

- **Walk**: hold and drag the left pad; up walks toward the display at about a meter a second at
  full deflection. **Back to start** returns to the origin.
- **Aim**: touch the right pad. The center points straight up, the rim points level, and the
  direction you touch is the direction the wand faces (up on the dome is toward the display).
- **Beam**: toggles `on`.

The page sends a pose at most twenty times a second while something changes; the app repeats the
last pose once a second while the page holds still, so the game keeps seeing a live wand.

## Configure

The settings page sets the **source** name (default `wand-sim`) and the **rate** (1 to 30 poses a
second). When the real base station arrives, give it the same source name and the mapping row needs
no change.
