---
sidebar_position: 3
title: Controller List
---

# Controller List

![Controller List](/img/ctrllist.png)

The Controller List on the Controllers screen shows a combination of all configured and detected controller devices.

Above the table, the title row shows a summary of controller [status](#present--absent--unregistered) next to the everyday commands:
- **Refresh all** re-reads the details of every *Present* controller.  No network scan is needed — it asks each controller that is already known to be on the network.
- **New record** creates an EZPlayer controller record by hand.

The toolbar below it holds the view options on the left ("Show unidentified": when checked, network devices that are not known to be controllers are shown in the table) and, on the right, the bulk device actions that apply to all present controllers ("Reconfigure all" and "Reboot all"), offered if applicable.  "Reconfigure all" covers the show's player too, with the one upload that means anything to it — its send list.

Below this is a table with records for each network device / controller:
- Clicking the headers allows sorting of the table
- Each row shows the state, enabled state, name, IP, type, and frame-rate cap ("Max FPS") for a network device
- For devices with details, a foldout icon is available on the left end of the row
- For devices that allow [actions](./controlleractions.md), a "kebab" menu is available on the right end of the row

### Max FPS
Some controllers cannot keep up with the show's frame rate.  The **Max FPS** column shows the frame-rate cap in effect for the controller.  Use **Edit record** to set or clear the override; it takes effect the next time the show output is (re)started.

## Status / Terminology

### Enabled / Disabled
*Enabled* ![Controller Enabled](/img/ctrlenabled.png) means that the controller is configured for sending live data as part of the show; *Disabled* ![Controller Disabled](/img/ctrldisabled.png) means that it is not.  The controller is usually disabled by marking it as "Inactive" in xLights.

### Player / Remote / xLights Only
A controller that keeps its own copy of the show is not sent pixel data, so the **Enabled** column names the part it plays instead of calling it enabled:

- **player** plays the whole show from its own copy.
- **remote** plays its own channels from its own copy, and follows this player's sync for timing.
- **xLights only** is how xLights records a controller the show must not send pixels to, which is to say a player or a remote.  EZPlayer reads it as a remote, unless the controller's own record names a part — which it does by hand with **Edit record**, and which outranks the layout.

A part set by hand takes effect on the grid at once, and in the show itself when playback next starts: that is when the player decides which controllers are sent pixel data and which are sent sync.

A HinksPix is the exception.  It does have a remote role, but that role follows a *HinksPix* master rather than this player's sync, so EZPlayer never makes one a remote: marked "xLights Only", a HinksPix is given the show's content as a player and left to play it from its card.  Asking for a remote is refused with that explanation.

**Edit record** sets the part by hand.  Its first choice, *Whatever the xLights layout says*, is the default and is not the same as *Enabled*: it leaves the answer to the layout, where *Enabled* is the stronger statement that this is an ordinary controller taking the show's live data, and would quietly stop an "xLights Only" remote being a remote.

Changing the record is only half of it.  The part a controller is *in* is a setting on the controller, written when it is reconfigured, and a board left in player or remote mode takes no live data at all.  So after moving a controller back to taking live data, **Reconfigure** it; until then the row carries a warning that says which mode it is actually in.

### Red / Green / Unlit
Red ![Controller Red](/img/ctrlred.png) / Green ![Controller Green](/img/ctrlgreen.png) / Unlit ![Controller Unlit](/img/ctrlunlit.png) status light - Unlit means the controller is disabled.  Green indicates that the controller is responding to pings.  Red means no ping response.

### Present / Absent / Unregistered
A *Present* ![Controller Present](/img/ctrlpresent.png) controller is enabled in the controller configuration and is responding to pings.  An *Absent* ![Controller Absent](/img/ctrlabsent.png) controller is in the configuration but is not responding.  An *Unregistered* ![Controller Unregistered](/img/ctrlunregistered.png) controller was found during network scan only, and may be responding to pings, but is not in the configuration.

### Warning Alert
A warning ![Controller Alert](/img/ctrlalert.png) indicator is presented when a controller needs attention.  Hovering or expanding the controller details will reveal more about the warning, and clicking it opens a comparison of what xLights asks for against what the controller reports.

Several things can ask for attention on a row, and they are separate because each has its own fix:

- **Ports or input config differ from xLights** — **Reconfigure** the controller.
- **The controller is in the wrong mode** — it reports itself as a player or a remote while the show wants it to take live data, or the other way round.  Also fixed by **Reconfigure**; it is called out on its own because every port can read as correct while the controller sits dark.
- **The player's send list differs from the layout** — only on the show's player: a controller is missing from the list, switched off in it, or sent the wrong channels or address.  Fixed by **Send output universes**.  Called out because it is the one fault no controller can show you: every box can be configured perfectly and still be sent nothing.
- **Content delivery needed** — the device holds its own copy of the show and that copy is behind; see [Content Distribution](contentdistribution.md).

## Controller Details

![Controller Details](/img/ctrldetails.png)

:::note
The availability of details varies by controller vendor, model, and installed firmware.  See the [support matrix](./supportmatrix.md) for a summary.
:::

:::note
Refreshing controller details may be disruptive, and is not done automatically.  Be sure to refresh the controller details for the latest information from your controller.
:::

### Health
This section reports high-level health and a description of the controller.  It also indicates whether the controller's input and output maps match the player configuration.

### Basic
This section provides information about the device type, network address, and installed firmware.

### Operational
This section provides modes, uptimes, voltages, temperatures, fan speeds, etc.

### Show stats
This section includes network and protocol information for the controller.

### Models & Ports
This section details the controller's configured pixel ports and models.  Note that this is the controller's information; the **Compare** option at the top can be used to compare the configuration to that in the [port map](./portmap.md).