# Overlay Effects app

Paints animated effects onto the submodels of the models you choose, one overlay lease per submodel
(or one lease on the model itself when it has no submodels), and shows the frame rate the player
actually takes. It is the `overlay-submodels` developer script as an EZPlayer app: the effects and the
geometry that fits them to a target are the same; what is new is that the owner picks the models,
turns effects on and off, pins an effect to a target, and reads the numbers on a page instead of in a
terminal. Plain Node (22+), no dependencies.

Use it to answer "what frame rate are we getting?" for a layout with many leases, to compare HTTP
and UDP delivery, or just to decorate a spinner.

## Install

In the player, open the Apps tile and point it at this folder (the one holding `ezapp.json`). The
player creates an instance and gives it a token; nothing else to set up.

## Configure

Open the instance's settings page (the gear on the Apps tile).

- **Models**: tick the models to paint, A to Z, each showing what xLights draws it as and how many
  submodels it has. Search by name and tick or untick everything the search shows, or tick every model
  of one type (all the trees, say) or an xLights model group in one go. A model with submodels gets a
  lease per submodel; a model without gets one lease of its own.
- **Frames per second**: 1 to 60. **Blend**: how the overlay combines with the sequence
  (`replace` by default).
- **Send frames over UDP**: on, frames go as overlay packets, fast and lossy; off, each target gets
  one HTTP `PUT` per frame, which is simpler and acknowledged. At most 16 `PUT`s are in flight at once:
  hundreds landing together slow the player for every other client, this app's own status included.
- **Start painting when the app starts**: otherwise the loop waits for Start.
- **Seed**: each target draws its effect from the enabled ones with this seed, so the same seed gives
  the same picture; a new seed gives a new draw. Reshuffle on the public page draws a fresh seed
  for the current run without changing the saved one (the seed in use is shown under the readouts).
- **Effects**: a checkbox per effect. Unticked effects are left out of the draw, which changes what
  the other targets get.
- **Pinned effects**: fix a model's effect, on every target it has. A pin wins over the draw and
  over the checkboxes. Changing a pin while the loop runs applies at once; Save keeps it. A pin saved
  under a target's own name (`Spinner/Arms`) still applies to just that target.

Save writes the private `settings` document. The app re-reads it every five seconds while idle; a
running loop keeps its leases until it is restarted (the settings page offers a restart button while
the loop runs). Through the cloud console the model list cannot be fetched, so the page keeps the
models already chosen and lets you change everything else.

Show inputs `start` and `stop` can be mapped on the Apps card so a button or a schedule starts and
stops the painting.

## The page

Open the instance page (LAN link or the cloud link). Start opens the leases and runs the frame loop,
Stop releases them so the show has its models back, Reshuffle draws new effects. The list at the
bottom shows every target with the lease it takes (`buffer 12x8`, `grid 64x32` or `nodes`) and the
effect it got.

The numbers:

- **Frames per second**: frames painted and handed to the player per second, counted over the last
  two seconds, against the configured target. Amber under 90% of target, red under 60%.
- **Frame ms avg / max**: the time one frame takes from the start of painting until every target's
  payload has been sent (HTTP: the `PUT` answered; UDP: the packets handed to the socket), averaged
  over the last two seconds, and the slowest frame in that window. Max turns amber when a frame took
  longer than the frame interval.
- **Late frames**: frames in this run that started more than half a frame interval after they were
  due. When the loop falls a whole frame behind it drops the missed frames rather than bursting to
  catch up, so the fps readout stays honest.
- **Data rate**: payload bytes sent per second (pixels only, not HTTP or packet headers).
- **Leases**: targets being painted. **Transport**: HTTP or UDP, with the count of sends that failed.

The loop waits with plain timers, which fire on the platform's timer tick: about 1 ms on Linux and
macOS, about 15.6 ms on Windows. The app measures the tick at startup (`timerTickMs` in the status)
and aims each wait half a tick short, so a frame starts within half a tick either side of its due
time. On Windows that means jitter of up to 8 ms at any rate, which the page points out once the frame
interval gets within three ticks (above about 20 fps). Spinning the CPU to do better would load the
machine the player runs on, which is the thing being measured.

## Effects

| Name      | What it does                                                                     |
| --------- | -------------------------------------------------------------------------------- |
| `comets`  | A comet runs out along each strand, alternate strands half a beat apart          |
| `sweep`   | A bright sector sweeps around the strands like a radar                           |
| `rings`   | Each strand is one color and the colors march from strand to strand              |
| `twinkle` | Icy sparkle                                                                      |
| `snow`    | Night sky, falling snow, a drift and a little tree, drawn where the nodes are    |
| `waves`   | Hue and brightness ripple across the face                                        |
| `rainbow` | A diagonal rainbow slides across the face                                        |
| `ripple`  | Rings spread from the center                                                     |
| `checker` | A two-color checkerboard that flips twice a second                               |
| `stripes` | Slanted bright stripes roll over the face                                        |
| `chase`   | Three shades chase along each strand                                             |

Every effect paints every kind of target. A submodel's strands are the rows (or columns) of its
xLights render buffer, a matrix's strands are its rows, and a target painted by nodes is split by
its strand list. The hue of each target follows its place across the yard, as in the script.

## Events

The page sends `{ type: 'start' }`, `{ type: 'stop' }` and `{ type: 'reshuffle' }`. The settings page
also sends `{ type: 'setEffect', target, effect }` (ignored when it comes through the show's cloud
page) and `{ type: 'restart' }`. Leases live on the player's frame pipeline, so the player must be
playing (songs or idle frames between them) for the app to plan or paint; stopped, it waits and says so.
Status is published at least twice a second while running, and
whenever it changes otherwise. `phase` is `idle`, `starting` (reading the models or opening the leases,
with the count so far in `message`), `running` or `stopping`; leases opened so far are kept alive while
the rest open, so a slow start on a big layout does not lose them:

```json
{
  "phase": "running",
  "fps": { "target": 20, "achieved": 19.5 },
  "frameMs": { "avg": 3.1, "max": 12.4 },
  "bytesPerSec": 184320,
  "lateFrames": 0,
  "targetCount": 14, "modelCount": 3, "modelsRev": 2,
  "models": [{ "model": "Spinner", "targets": 8, "nodes": 768, "lease": "8 buffer", "effect": "mixed", "pinned": false }],
  "effectsAvailable": ["comets", "sweep", "rings", "twinkle", "snow", "waves", "rainbow", "ripple", "checker", "stripes", "chase"],
  "message": "Painting 14 targets at 20 fps over HTTP"
}
```

The status lists one row per model, not per target: a layout can hold twenty thousand submodels, and
a row for each is megabytes that no page can draw (one such table brought a 32-core machine to a
crawl). A row carries the number of targets on the model, their nodes, a lease summary and the effect
(`mixed` when the targets differ). The rows are the bulk of the status, so they ride along only when
the list changed (`modelsRev` bumps) and every ten seconds for a page that joined late; a status
without `models` means the list a page already has still stands, and the pages redraw only on a new
`modelsRev`. The player accepts a status of up to 4 MB, so above 5000 models the list is left out
altogether (`modelsListed` is false) and `targetCount` and `modelCount` carry the numbers; the pin
table on the settings page then says so, and pins saved earlier still apply by name.
Over UDP a payload handed to the socket counts as the lease's keepalive, so the keepalive call is only
made for a lease whose sends fail.
