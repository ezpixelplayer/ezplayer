---
sidebar_position: 3
title: Controller List
---

# Controller List

![Controller List](/img/ctrllist.png)

The Controller List on the Controllers screen shows a combination of all configured and detected controller devices.

Above the table, the title row shows a summary of controller [status](#present--absent--unregistered) next to the following commands:
- **Reload show & controllers** re-reads the show folder, resets the layout, reopens all controllers, and restarts the show as applicable.
- **Refresh all** re-reads the details of every *Present* controller.
- **New record** creates an EZPlayer controller record by hand.

The toolbar below it holds the view options on the left ("Show unidentified": when checked, network devices that are not known to be controllers are shown in the table) and, on the right, the bulk device actions that apply to all present controllers:
- **Reconfigure all** sends the configuration to all the show's controllers and players.
- **Reboot all** reboots all responsive players and controllers.
- **Distribute content** sends needed content to the show's players and remotes.
- **Content status** opens the content status dialog.

Below this is a table with records for each network device / controller:
- Clicking the headers allows sorting of the table
- Each row shows the state, enabled state, name, IP, type, and frame-rate cap ("Max FPS") for a network device
- For devices with details, a foldout icon is available on the left end of the row
- For devices that allow [actions](./controlleractions.md), a "kebab" menu is available on the right end of the row

## Status / Terminology

### Enabled / Disabled / Player / Remote / xLights Only

For controllers that receive data from EZPlayer directly during the show:

- **Enabled** ![Controller Enabled](/img/ctrlenabled.png) means that the controller is configured for sending live data as part of the show
- **Disabled** ![Controller Disabled](/img/ctrldisabled.png) means that it is not.  The controller is usually disabled by marking it as "Inactive" in xLights.

A controller that keeps its own copy of the show is not sent pixel data, so the **Enabled** column names the part it plays instead of calling it enabled:

- **Player** ![Controller Player](/img/ctrlplayer.png) plays the whole show from its own copy.
- **Remote** ![Controller Remote](/img/ctrlremote.png) plays its own channels from its own copy, and follows another player's sync for timing.

The role is usually detected from the xLights layout, but **Edit record** can be used as an override.

![Part in the show](/img/ctrlpart.png)

Once the record is changed, the **Reconfigure** command should be used to inform the controller of its role.

### Red / Green / Unlit
Red ![Controller Red](/img/ctrlred.png) / Green ![Controller Green](/img/ctrlgreen.png) / Unlit ![Controller Unlit](/img/ctrlunlit.png) status light - Unlit means the controller is disabled.  Green indicates that the controller is responding to pings.  Red means no ping response.

### Present / Absent / Unregistered
A *Present* ![Controller Present](/img/ctrlpresent.png) controller is enabled in the controller configuration and is responding to pings.  An *Absent* ![Controller Absent](/img/ctrlabsent.png) controller is in the configuration but is not responding.  An *Unregistered* ![Controller Unregistered](/img/ctrlunregistered.png) controller was found during network scan only, and may be responding to pings, but is not in the configuration.  An *Unknown* controller is in the configuration but nothing has looked for it yet: no scan has run and no ping has been tried, which is a weaker statement than *Absent*.

### Details not read
The ![Details not read](/img/ctrlunknown.png) mark beside the state means the controller's details (ports, firmware, stats, etc.) have not been read yet.  **Refresh Details** reads them, or the player does on its own when [Read controller details automatically](../../settings/player.md#controllers) allows.

### Error Indicator
The ![Operation failed](/img/ctrlerror.png) indicator appears when the last operation on the controller (a reconfigure, a reboot, a content send) failed.  Clicking it shows the message and when it happened; **Dismiss** clears it.

![A failed reconfigure](/img/ctrlerrorpopover.png)

### Warning Alert
A warning ![Controller Alert](/img/ctrlalert.png) indicator is presented when a controller needs attention.  Hovering or expanding the controller details will reveal more about the warning, and clicking it opens a comparison of what EZPlayer expects against what the controller reports.

Several things can require attention:

- **Ports or input config differ from expected** — **Reconfigure** the controller.  A universe in the layout past the last channel any model on the controller uses is not part of the comparison: xLights leaves one behind now and then, and neither upload writes it.
- **The controller is in the wrong mode** — it reports itself as a player or a remote while the show wants it to take live data, or the other way round.  Also fixed by **Reconfigure**.
- **The player's send list differs from expected** — only on an FPP player: a controller is missing from the list, switched off in it, or sent the wrong channels or address.  Fixed by **Send output universes**.
- **Content delivery needed** ![Content delivery needed](/img/ctrlcontent.png) — the device holds its own copy of the show and that copy is not current; see [Content Distribution](contentdistribution.md).

### Informational Mark
The ![Informational](/img/ctrlinfo.png) mark indicates there is something that may be worth knowing, but that requires no action.  Hovering over the mark gives the details, and clicking opens the comparison.

### Max FPS
Some controllers cannot keep up with the show's frame rate.  The **Max FPS** column shows the frame-rate cap in effect for the controller.  Use **Edit record** to set or clear the override; it takes effect the next time the show output is (re)started.

### Send-from address
xLights can pin a controller to one of the computer's network interfaces (**Force Local IP** on the controller, or **Global Force Local IP** on the Controllers tab).  EZPlayer sends from that address and shows it in the controller's details.  An address that is not assigned to any network interface on this computer — after a network change, say, or on a different computer than the layout was made on — is ignored, as xLights ignores it: the show goes out the default interface, and the row carries an informational mark saying so.  **Edit record** can set a different address for this player; it takes effect the next time the show output is (re)started.

## Controller Details

![Controller Details](/img/ctrldetails.png)

:::note
The availability of details varies by controller vendor, model, and installed firmware.  See the [support matrix](./supportmatrix.md) for a summary.
:::

:::note
Refreshing controller details may be disruptive, so by default it is only done automatically while nothing is playing (see [Player settings](../../settings/player.md#controllers)).  Be sure to refresh the controller details for the latest information from your controller.
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