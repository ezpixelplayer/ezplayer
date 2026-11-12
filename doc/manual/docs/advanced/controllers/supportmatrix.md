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
| ILightThat | B8, B17 | 3.5, 3.7 | Lab | 0.6.9 | CVS |
| ILightThat | DMX, Switchy | 3.7 | Lab | 0.6.9 | CVS |
| ILightThat | Input8, Signals | 3.7 | Obtained | | |
| J1Sys |  |  | Not Planned | | |
| LoR | Aurora | | Planned | | |
| Minleon |  |  | Not Planned | | |
| Pixlite | | | Obtained | | |
| San Devices | | | Obtained | | |
| Twinkly |  |  | Not Planned | | |
| Vivid | | | Planned | | |
| WLED | Dig Quad | Latest | Lab | 0.6.9 | CVS |
| WLED | GLEDOPTO |  | Obtained | | |
| WLED | RGB2Go |  | Obtained | | |

## Test Status Meaning
- **Not Planned** means support is low priority; there are no plans to acquire a board
- **Planned** means support would be considered
- **Obtained** means a board is in possession for lab use and in some stage of installation or driver coding
- **Lab** means a board is installed in the lab and is passing routine, automated testing
- **Field** means a controller has been field deployed and successfully used in a show while being managed with EZPlayer

## Support Level

This column indicates the extent to which details and actions are supported.
- 'C': Config
- 'V': Verify
- 'S': Stats
- 'P': Power
- 'D': Content Distribution

A controller can only be sent content if it has EZPlayer support and has storage installed.  The table below shows which controllers support [Content Distribution](contentdistribution.md):

| Driver | Local storage | EZPlayer sends it | Works as Remote | Test Status | As Of |
| - | - | - | - | - | - |
| FPP (Cape, Colorlight, Panel) | Yes | Yes | Yes | Lab | 0.6.14 |
| Falcon (V4/V5) | Yes, SD card | Yes | Yes | Lab | 0.6.14 |
| Genius (firmware 2.x+) | Yes, SD card | Yes | Yes | Lab | 0.6.14 |
| HinksPix | Yes, SD card | Yes | No | Lab | 0.6.14 |
| AlphaPix | No | - | | | |
| ESPixelStick | No | - | | | |
| ILightThat | No | - | | | |
| WLED | No | - | | | |

Note that content delivery may have different firmware requirements compared to basic data and configuration support.
