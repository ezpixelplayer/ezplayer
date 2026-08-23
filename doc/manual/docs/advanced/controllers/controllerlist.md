---
sidebar_position: 3
title: Controller List
---

# Controller List

![Controller List](/img/ctrlred.png)

The Controller List on the Controllers screen shows a combination of all configured and detected controller devices.

Above the table header, a summary of controller [status](#present--absent--unregistered) is shown, and global actions ("Upload all" and "reboot All") are offered if applicable.

If the "Show unidentified" checkbox is checked, network devices that are not known to be controllers are shown in the table, otherwise they are not.

Below this is a table with records for each network device / controller:
- Clicking the headers allows sorting of the table
- Each row shows the state, name, IP, and type for a network device
- For devices with details, a foldout icon is available on the left end of the row
- For devices that allow [actions](./controlleractions.md), a "kebab" menu is available on the right end of the row

## Status / Terminology

### Enabled / Disabled
*Enabled* means that the controller is configured for sending live data as part of the show; *Disabled* means that it is not.  The controller is usually disabled by marking it as "Inactive" in xLights.

### Red / Green/ Unlit
Red ![Controller Red](/img/ctrlred.png) / Green ![Controller Green](/img/ctrlgreen.png) / Unlit ![Controller Unlit](/img/ctrlunlit.png) status light - Unlit means the controller is disabled.  Green indicates that the controller is responding to pings.  Red means no ping response.

### Present / Absent / Unregistered
A *Present* ![Controller Present](/img/ctrlpresent.png) controller is enabled in the controller configuration and is responding to pings.  An *Absent* ![Controller Absent](/img/ctrlabsent.png) controller is in the configuration but is not responding.  An *Unregistered* ![Controller Absent](/img/ctrlunregistered.png) controller was found during network scan only, and may be responding to pings, but is not in the configuration.

### Warning Alert
A warning ![Controller Alert](/img/ctrlalert.png) indicator is presented when a controller needs attention.  Hovering or expanding the controller details will reveal more about the warning.

## Controller Details

![Controller Details](/img/ctrldetails.png)

:::note
The availability of details varies by controller vendor, model, and installed firmware.  See the [support matrix](./supportmatrix.md) for a summary.
:::

:::note
Refreshing controller details may be disruptive, and is not done automatically.  Be sure to refresh the controller details for the latest information from your controller.
:::

### Health
This section reports high-level health of the controller and its description.  It also indicates whether the controller's input and output maps match the player configuration.

### Basic
This section provides information about the device type, network address, and installed firmware.

### Operational
This section provides modes, uptimes, voltages, temperatures, fan speeds, etc.

### Show stats
This section includes network and protocol information for the controller.

### Models & Ports
This section details the controller's configured pixel ports and models.  Note that this is the controller's information, the "Compare" option at the top can be used to compare the configuration to that in the [port map](./portmap.md).