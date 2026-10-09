---
sidebar_position: 5
title: Show Settings
---

# Show Settings

On [EZRGB](https://ezrgb.com), open **Show Settings** to configure your show
identity and the public page viewers open in a browser.

Changes save when you confirm each row or dialog. Click the edit control on a
row, change the value, then save. Toggles and options dialogs save when you
apply them.

This page is separate from the player's
[Viewer Control](../advanced/viewer-control.md) settings, which control when
the player accepts requests and which playlist is used.

## Core Show Settings

| Setting | What it does |
| --- | --- |
| **Show name** | Display name for the show (3–50 characters). |
| **Frequency** | FM tune-to frequency for listeners. |
| **Message** | Optional text for tune-to signage and other physical displays. |
| **3D** | Layout dimension: Auto, 2D, or 3D. |
| **FPS** | Render frame rate: Auto, 20, or 40. |
| **Use EZPlayer** | **Yes** if this show runs on EZPlayer; **No** if you use another playback system. |

If you have not set a custom URL slug, changing the show name also updates the
slug derived from that name.

## Viewer Page Settings

### Page access

| Setting | What it does |
| --- | --- |
| **Viewer page** | Enables or disables the public show page. |
| **URL slug** | Path segment for the page (`/shows/<slug>`). Use lowercase letters, numbers, and hyphens. |
| **Share link** | Shown when the page is enabled and a slug is set. Copy the URL, open it, or download a QR code. |
| **Player region** | Which player-server region to use, or **Auto** to let the cloud choose. |

### Look and media

| Setting | What it does |
| --- | --- |
| **Logo** | Upload or remove the show logo. |
| **Show image** | Upload or remove the main show image. |
| **Viewer page theme** | Pick a theme preset, or customize colors and fonts. |

Use **Preview in window** at the top of this card to open a live preview of the
viewer page.

### Page sections

Each of these can be turned on or off. Where **Options** is available, open it
to set how that section looks.

| Section | Options |
| --- | --- |
| **Now playing** | Size (minimal / compact / detailed), next song, cover art, status pills, time display. |
| **Listen** | In-browser listen, FM (uses **Frequency**), optional Tune2 URL, optional PulseMesh URL. |
| **Song list** | Simple list, searchable table, or gallery; show vendor; hide while viewer control is active. |
| **Schedule** | List or calendar; how many upcoming shows (list); show request-line hours. |
| **Location** | Address and optional latitude / longitude. |
| **Contact** | Style (card / list / inline), optional heading, and social or website links. |
| **Ad footer** | Show or hide the ad footer. |

### Viewer control

Opens a dialog for how viewers interact on the public page:

- **Off** — no requests or votes.
- **Request** — viewers add songs to a queue.
- **Vote** — viewers vote on songs.

Also configure anonymous participation, repeat cooldown, queue limits (request
mode), vote scope and reset (vote mode), and the list style (simple /
searchable / gallery).

When and which playlist the player uses for requests is still set in EZPlayer
under [Viewer Control](../advanced/viewer-control.md).

### Page template

Markdown for the main page body. Use the in-app markdown guide while editing
for formatting, placeholders (such as show name and tune-to), and widget
tokens (such as `{{nowplaying}}` or `{{viewercontrol}}`).

Enabled sections you do not place with a widget token still appear in the
default page stack.
