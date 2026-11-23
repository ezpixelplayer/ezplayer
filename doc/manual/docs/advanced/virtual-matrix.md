---
sidebar_position: 4
title: Virtual Matrix
---

# Virtual Matrix

:::note
Requires EZPlayer 0.7 or later.
:::

A virtual matrix shows one model of your layout as a picture: every pixel of the model becomes one block of the picture, updated as the show plays. Use it to drive anything that takes a picture instead of pixel data:

- a projector, TV or monitor plugged into the player computer,
- LED panel software that captures part of the screen,
- a tablet or another computer on the network, in its browser.

It works best with models that are a grid, such as matrices and pixel trees. Any other model is shown as a single strip of its pixels in wiring order.

A virtual matrix is display only. It needs no controller and does not change what your controllers receive.

## Setting up an output

Open **Settings** and choose **Virtual Matrix**, then click **Add output**. Each output has:

- **Model** - the model to show. Type in the box to search. The list is alphabetical and shows each model's size. **List matrix models only** (on by default) hides models that are not a grid; clear it to pick any pixel model.
- **Show** - where the picture goes; see below.
- **Smooth** - blend between pixels instead of drawing crisp blocks. Leave it off for LED panels and turn it on for projection on a wall.
- **Enabled** - opens or closes the output without removing it.
- The **link** for the output, with a button to copy it.

Outputs are saved with the show folder and belong to this computer; they are not sent to the cloud.

### Full screen

Fills one display of the player computer.

- **Display** - which display. EZPlayer remembers the display itself, so the output returns to the right one if displays are unplugged and plugged back in.
- **Picture** - **Keep aspect ratio** shows the model in its own proportions with black bars where the display is a different shape. **Scale to fit** stretches it to cover the whole display.

### Floating window

A borderless window that stays on top of other windows, for LED panel software that sends a region of the screen to the panels.

- **Window size** - **1:1** makes the window exactly as many screen pixels as the model has pixels. **Custom size** lets you type the exact width and height.
- Drag the window anywhere on the desktop. Its position is saved and restored the next time the output opens, and is shown in the settings.

Sizes are in screen pixels, whatever the display's scaling is set to. The position shown in the settings is in the operating system's own desktop units, which are not screen pixels on a scaled display; set the display's scaling to 100% if you need to place the window by number.

The operating system will not make a window smaller than a certain size (on Windows, about the height of a title bar). A picture smaller than that is drawn at its exact size in the top-left corner of the window, with black around it.

### HTTP URL only

Opens nothing on the player computer. The picture is available at the output's link, which any browser on your network can open. Use this when the screen is on another device.

The link also works for the other two kinds of output, and for any model without setting up an output at all:

```
http://<player address>/matrix?model=<model name>
```

Capitalization of the model name does not matter. Add `&smooth=1` for smooth scaling and `&fit=fill` to stretch the picture to the page. Put the browser in full-screen mode (usually F11) to hide its toolbars.

## Frame rate

The picture follows the sequence's own frame rate: a 40 frames-per-second sequence is shown at 40 frames per second, with no setting to adjust. What you see is limited by the refresh rate of the display.

## Checking that it works

When an output is set up, or anything is viewing a model's link, the **Show Status** screen has a **Virtual Matrix** card. Each line shows:

- **Showing** - the output is running, with the frames per second it shows out of those the player makes, such as "40 of 40 fps shown".
- **Slow** - the output shows noticeably fewer frames than the player makes. The viewing computer or its network connection is not keeping up.
- **Idle** - the output is open but nothing is playing.
- **Not read** - an enabled output is not showing, or nobody has a link open.
- **Off** - the output is not enabled.

Viewers that open a link you have not set up as an output are listed too, with the address they come from.
