---
sidebar_position: 7
title: Shell
---

# Shell

<!-- SCREENSHOT: the Shell tile in the Settings gallery, and/or the terminal
     dialog with a command run in it. Drop the file at
     doc/manual/static/img/shell.png and the line below will pick it up. -->

![Shell](/img/shell.png)

Opens a **terminal on the machine running EZPlayer** — the same shell you would
get sitting at that computer, reachable from the desktop app, the LAN web UI,
and the cloud player site.

## This tile only exists if you turned it on

There is no switch here, or anywhere else in the UI. The Shell tile appears only
after someone runs this on the player machine:

```bash
ezplayer shell --show-folder "D:\Shows\MyShow" --password-file secret.txt
```

:::note
On Windows, run `ezplayer.cmd` (installed next to `EZPlayer.exe`) rather than
the `.exe` itself, and supply the password with `--password-file` — there is no
interactive prompt there. See the
[CLI reference](../reference/cli.md#remote-access-terminal-and-file-manager).
:::

Until then the feature is not merely hidden — the endpoint refuses every
connection, so there is nothing on the network to find. See
[Remote access](../reference/cli.md#remote-access-terminal-and-file-manager) in
the CLI reference for the full command, and for how to disable it again with
`--clear`.

The password is per **show folder**, so it travels with the show rather than
living on the machine.

## Using it

Click the tile, enter the shell password, and you get a terminal. It starts in
your home directory, running your platform's normal shell (`cmd.exe` on Windows,
`$SHELL` elsewhere).

- **One terminal at a time, player-wide.** Opening another — from any UI —
  closes this one, and tells you that is what happened rather than just going
  quiet.
- **Closing the dialog ends the shell.** The process is killed when the window
  disconnects, so nothing is left running behind you.
- Repeated wrong passwords lock the endpoint out for escalating periods.

## Before you enable it

A shell is full control of the machine, so it is worth being deliberate:

- **Over the cloud, your password is encrypted** end to end. A remote attacker
  needs the cloud URL, the player token, *and* this password.
- **On the LAN it is not.** The LAN UI is plain HTTP, so someone sniffing your
  local network as you log in could capture the password. That is true of the
  whole LAN surface, which has no authentication at all — but it matters more
  here.
- The [Files](./files.md) tile has a **separate** password. Granting the file
  manager does not grant a shell.
