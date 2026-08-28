---
sidebar_position: 5
title: Port Map
---

# Port Map

![Controller Port Map](/img/ctrlportmap.png)

The controller port map shows which models (lighting props) are connected to the controller.  Models may span multiple ports, and multiple models may be chained on the same port.

Every pixel port the controller has is listed, starting at port 1, whether or not anything is plugged into it — the port count comes from the controller's capability definition (vendor / model / variant), or from the device itself once its details have been read.

Serial ports (DMX, Renard, Pixelnet, …) are listed separately below the pixel ports.  Models on a serial protocol are counted in channels rather than pixels, and a serial port is never mistaken for a pixel port.