---
sidebar_position: 4
title: Controller Actions
---

# Controller Actions

![Controller Actions](/img/ctrlactions.png)

The controller actions available depend on the driver for the selected item, but may include:
- **Port map**: Opens the [Port Map](portmap.md), showing the expected configuration for the controller.
- **Refresh Details**: Populates or refreshes the controller details.
- **Open**: Opens the controller web page.  For this to work, the controller must be reachable via the network or via proxy through EZPlayer.
- **Reboot**: Allows soft and/or hard reboot of the controller, depending on the model.
- **Reconfigure**: Configure the controller according to its input settings and Port Map.  It also puts the controller back into the part the show asks of it, which matters after a controller has been a player or a remote: a board left in one of those modes takes no live data at all, and its share of the display stays dark however correct its ports are.
- **Send output universes**: Offered on the show's player instead of **Reconfigure**, which a player has no ports for.  It writes the player's send list — which controller is sent which channels — from the layout.  A player still pointing at a previous show's channels is how a show comes up with one controller lit.
- **Send content**: Sends this show's sequences and their audio to a controller that keeps its own copy of the show; see [Content Distribution](contentdistribution.md).  The item reads **Distribute content** when the device is not behind the show, and is offered only for a device that holds content at all.
- **Check content**: Reads the device's own file list and reports what a send would transfer, without transferring anything.
- **Enable**/**Disable**: Enable/Disable the controller from use by EZPlayer.

The actions also provide options for EZPlayer recordkeeping:
- **Promote...**: Save a record for a discovered controller that was not yet configured.
- **Edit record**: Edit EZPlayer controller-specific information.
- **Delete record**: Delete the controller's record from EZPlayer.