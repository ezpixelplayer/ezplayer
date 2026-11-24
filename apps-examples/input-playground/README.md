# Input Playground app

A screen of pretend show inputs: buttons, switches, sliders and a text box. Every tap, flip, drag or
Enter makes the player the exact HTTP call a real controller board (a Baldrick Input8, a Falcon, an FPP
box) would make to the show-inputs endpoint, and the page shows what the player answered. Use it to wire
up and try input mappings on the Apps card before any hardware is on the bench. Plain Node (22+), no
dependencies.

## Install

In the player, open the Apps tile and point it at this folder (the one holding `ezapp.json`). The
player creates an instance and starts it; nothing else to set up. Opening the instance page shows the
default layout: eight buttons (`button1` to `button8`), two switches (`switch1`, `switch2`), two sliders
(`slider1`, `slider2`) and a text box (`text1`), all under the source name `playground`.

## Use it

1. Open the instance page (LAN link or from the cloud console). Press a button. The log at the bottom
   shows the call that was made and the player's answer, `HTTP 200, delivered: 0`: the call worked but
   no instance input is mapped to it yet.
2. On the Apps card, under **Show inputs**, add a row: source `playground`, name `button1`, and the
   instance and input it should drive (an app lists its inputs in its manifest; the tetris example takes
   `left`, `right`, `rotate`, `drop` and so on).
3. Press the button again. The answer becomes `delivered: 1` and the mapped app receives the press as an
   event, exactly as it would from the real board.

The settings page (the gear on the Apps tile) shows a live table of what each control is wired to, read
from the player's mapping table, and lets you change the source name or edit the layout as JSON.

Keys 1 to 9 press the first nine buttons. A button in `press-release` mode sends 1 on the way down and 0
on the way up, for apps that watch how long a button is held.

## The calls

The source name and the control name make up the path. With the default layout, `button1` is:

```
POST http://<player>:3000/api/ezp/inputs/playground/button1
Content-Type: application/json

{ "value": 1 }
```

Every other button press uses the GET form instead, which boards that cannot post use (the log says
which form each call took):

```
GET http://<player>:3000/api/ezp/inputs/playground/button1?value=1
```

Note that a GET value reaches the mapped app as the string `"1"`, a POST value as the number `1`, which
is also what happens with real boards; an app reading `value` should accept both.

| Control             | Kind      | Call                                                                 |
| ------------------- | --------- | -------------------------------------------------------------------- |
| Button, `press`     | press     | `POST …/<source>/<name>` `{ "value": 1 }` (or `GET …?value=1`)       |
| Button, `press-release` | press, release | `POST …` `{ "value": 1 }` on the way down, `{ "value": 0 }` on the way up |
| Switch              | set       | `POST …` `{ "value": true }` or `{ "value": false }`                 |
| Slider              | set       | `POST …` `{ "value": 0.42 }`, about ten a second while dragging, then the final value |
| Text box            | text      | `POST …` `{ "value": "the text" }` on Enter                          |

The player answers `{ "ok": true, "delivered": n }`, `n` being the number of running instances that
got the event. The mapped app receives:

```json
{ "type": "input", "input": "<its input name>", "source": "playground", "name": "button1", "value": 1 }
```

as an event whose `source` is `input:playground`. Source and control names are lower-case letters,
digits and dashes, up to 40 characters, which is the rule the player applies to the path.

Try the same calls from a shell to check that a real board will get through:

```
curl -X POST -H 'content-type: application/json' -d '{"value":1}' http://<player>:3000/api/ezp/inputs/playground/button1
curl 'http://<player>:3000/api/ezp/inputs/playground/button1?value=1'
```

## The layout

The layout is the instance's private data key `layout`, edited on the settings page:

```json
{
    "source": "playground",
    "cols": 4,
    "controls": [
        { "type": "button", "name": "button1", "label": "Start", "color": "#ff2a2a", "shape": "round", "mode": "press" },
        { "type": "button", "name": "fire", "label": "Hold to fire", "color": "#ffb52a", "shape": "wide", "mode": "press-release" },
        { "type": "switch", "name": "switch1", "label": "Snow machine" },
        { "type": "slider", "name": "slider1", "label": "Brightness", "min": 0, "max": 1, "step": 0.01 },
        { "type": "text", "name": "text1", "label": "Marquee message" }
    ]
}
```

`shape` is `round`, `square` or `wide` (two grid columns); `mode` is `press` or `press-release`. A
control with a bad name or type is dropped with a note on the settings page; with no usable controls
the default layout is used. The app re-reads the layout every five seconds, so no restart is needed.

## Status

The app publishes its status after every call and at least every two seconds:

```json
{
    "phase": "ready",
    "source": "playground",
    "controls": ["button1", "button2", "..."],
    "recent": [{ "at": 1700000000000, "name": "button1", "kind": "press", "method": "POST", "status": 200, "delivered": 1 }],
    "counts": { "sent": 12, "delivered": 9, "failed": 0 }
}
```

`recent` holds the last 30 calls (newest first), each with the exact `call` made and an `error` when
the player did not answer `ok`. `counts.delivered` counts calls that reached at least one instance;
`counts.failed` counts calls the player refused or that did not get through. The full `layout` is in
the status too, which is how the page draws itself.
