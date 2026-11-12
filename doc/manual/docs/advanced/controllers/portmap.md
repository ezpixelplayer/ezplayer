---
sidebar_position: 5
title: Port Map
---

# Port Map

![Controller Port Map](/img/ctrlportmap.png)

The controller port map shows which models (lighting props) are connected to the controller.  Models may span multiple ports, and multiple models may be chained on the same port.

Each prop shows how many lights it has and how many channels they take.  Lights that take three or four channels each are counted as pixels; lights that take one channel each, such as the outlets on an AC board or a single-colour string, are counted as nodes.

A controller counts in its own units, usually pixels of three channels, so a port of thirteen one-channel nodes reads back from it as five pixels over fifteen channels.  That is the same thing said two ways, not drift, and the comparison treats it so.
