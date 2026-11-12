---
sidebar_position: 7
title: Support Matrix
---

# Support Matrix

:::note
This support matrix pertains to [detailed controller status](controllerlist.md), [controller actions](controlleractions.md), and [content distribution](contentdistribution.md).  DDP and E1.31 controllers that have already been configured and respond to pings will work with EZPlayer even if detailed status and configuration actions are not available.
:::

As there are innumerable combinations of controller model, firmware version, and test scenario, this documentation will never be complete.  Please contact the team if you have any issues, or to request additional controller support.  We do our best to automate testing of boards we have as lab samples, but this doesn't rule out issues related to model and firmware differences, or nuances only apparent during manual testing.

| Driver | Model(s) | Firmware | Test Status | As Of | Support Level |
| - | - | - | - | - | - |
| AlphaPix | Classic 4 | Latest | Lab | 0.6.7 | CV |
| AlphaPix | Flex | Latest | Obtained | 0.6.7 | |
| ESPixelStick |  | | Obtained | | |
| Falcon | F16v3, F16v4, F16v5, F48v4, F48v5 | Various | Lab | 0.6.9 | CVSPD (content on V4/V5 only) |
| FPP (Cape) | WB1616, WB-48, K16 A-B, K16 Pro, K32 A-B, K32 Pro | 5.5-9.5 | Lab + Field | 0.6.7 | CVSD |
| FPP (Cape) | K16 Max | 9.5 | Lab | 0.6.7 | CVSPD |
| FPP (Cape) | K40D, K4PB, K128 | 9.5 | Obtained | | |
| FPP (Colorlight) |  |  | Obtained | | |
| FPP (Panel) |  |  | Obtained | | |
| Genius | 16, Pro 16, Pro 32, Long Range | 1.x | Lab | 0.6.9 | CVSP |
| Genius | Pro 16 | 2.2, 2.3 | Lab | 0.6.9 | CVSPD (no test pattern action) |
| HinksPix | PRO V1, V2, V3 (80) | Various | Lab + Field | 0.6.7 | CVSD |
| ILightThat | B8, B17 | 3.5, 3.7 | Lab | 0.6.9 | CV |
| ILightThat | DMX, Switchy | 3.7 | Lab | 0.6.9 | CV |
| ILightThat | Input8, Signals | 3.7 | Obtained | | |
| J1Sys |  |  | Not Planned | | |
| LoR | Aurora | | Planned | | |
| Minleon |  |  | Not Planned | | |
| Pixlite | | | Obtained | | |
| San Devices | | | Obtained | | |
| Twinkly |  |  | Not Planned | | |
| Vivid | | | Planned | | |
| WLED | Dig Quad | Latest | Lab | 0.6.9 | CV (see note) |
| WLED | GLEDOPTO |  | Obtained | | |
| WLED | RGB2Go |  | Obtained | | |

## Test Status Meaning
- **Not Planned** means support is low priority; there are no plans to acquire a board
- **Planned** means support would be considered
- **Obtained** means a board is in possession for lab use and in some stage of installation or driver coding
- **Lab** means a board is installed in the lab and is passing routine, automated testing
- **Field** means a controller has been field deployed and successfully used in a show while being managed with EZPlayer

:::note
A WLED sent its LED outputs twice before it has restarted — two configuration
writes that both carry `hw.led.ins` — doubles its output list and restarts, and
from then on any write that carries outputs restarts it again instead of
saving, whether from EZPlayer, from xLights, or from its own LED settings page.
EZPlayer writes each section of the configuration on its own, sends the outputs
once per boot, and reads every write back, reporting a board that kept its own
configuration as a failure rather than a success.  The cure for a board already
in that state is its file editor (`http://<address>/edit`): download `cfg.json`,
remove the duplicate entries from `hw.led.ins` (keep the ones on real output
pins), upload it back under the same name — the board restores it and reboots —
and reconfigure from EZPlayer again.
:::

## Support Level

This column indicates the extent to which details and actions are supported.
- 'C': Config
- 'V': Verify
- 'S': Stats
- 'P': Power
- 'D': Content Distribution

A controller can only be sent content if it stores content at all.  Most do not, and the table below says which do; see [Content Distribution](contentdistribution.md) for what is sent and how.

| Driver | Local storage | EZPlayer sends it | Test Status | As Of |
| - | - | - | - | - |
| FPP (Cape, Colorlight, Panel) | Yes | Yes | Lab | 0.6.14 |
| Falcon | Yes, SD card (V4/V5) | Yes | Lab | 0.6.14 |
| Genius | Yes, local playback | Yes, firmware 2.x | Lab | 0.6.14 |
| HinksPix | Yes, SD card | Yes | Lab | 0.6.14 |
| AlphaPix | No | - | | |
| ESPixelStick | No | - | | |
| ILightThat | No | - | | |
| WLED | No | - | | |

The firmware column of the main table above does not carry over to content distribution, which has its own version sensitivity.  For FPP, 7.0 and later take a chunked upload and earlier firmware takes an older single-request one; the older path has not yet been exercised below FPP 6.3.  Of the controllers that play from a card of their own, a Falcon needs a V4 or V5 board (a V2 or V3 has no card), a Genius needs firmware 2.x (1.x has no upload endpoint), and an EasyLights has no card slot.

These three are also not interchangeable with an FPP in what they can be sent: each takes a file built for its own firmware, which brings limits on compression, frame rate, file naming and audio format.  [Content Distribution](contentdistribution.md#controllers-that-play-from-their-own-card) lists them, along with which families have an audio output at all when playing by themselves.  A HinksPix additionally never follows this player's sync, so one holding content plays standalone from its card; EZPlayer will not configure it as a show remote.
