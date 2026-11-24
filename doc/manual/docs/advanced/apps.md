---
sidebar_position: 5
title: Apps
---

# Apps

:::note
Requires EZPlayer 0.7 or later.
:::

Apps are small programs that run next to the player and add something visitors can do: play a
game on a matrix from their phone, send a message to a cube of panels, light up a prop with an
effect. The player installs them into the show folder, starts them, serves their pages, keeps their
data and hands them the taps from visitors' phones. You manage all of it from the **Apps** tile of the
[Settings](../settings/overview.md) screen.

## Apps and instances

An **app** is a package: a folder in `<show folder>/apps/<id>/` with an `ezapp.json` file that says what
to run and which pages it has. An **instance** is one configured copy of an app, with its own name. Two
instances of the same app are fine: a message board on each of two matrices, or a game on two trees.
The instance name is part of its page address, `/apps/<name>/`.

Each instance has:

- an **enabled** switch. An enabled instance starts when the show opens and runs while its schedule allows.
- the **visitors' page**, at `http://<player>:3000/apps/<name>/` on the home network, and through the
  show's cloud page when the show page lists apps.
- a **settings page** of its own, when the app has one, opened from the gear icon.
- a **startup report**: which runtime was used, the port it was given, when it started, when its first
  status arrived, and the last lines it printed.
- its own **data**, under `<show folder>/apps-data/<name>/`, which a reinstall of the app keeps.

## Installing

Under **Installed apps**:

- **Install all from ezplayer-contrib** downloads the curated apps from the
  [ezplayer-contrib](https://github.com/ezpixelplayer/ezplayer-contrib) repository.
- **Install** takes a folder on the player computer that holds an `ezapp.json`, or an `https` link to a
  `.tar.gz` archive, such as a GitHub archive link. Every app found in the archive is installed.
- The trash can uninstalls a package. Its instances stay listed, marked missing, until you remove them.

Installing again replaces the package and restarts its instances. Apps run with the player's own
permissions, so install only what you trust.

## Runtimes

- **JavaScript** apps run with the player's own Node; nothing to install.
- **Python** apps need Python 3 on the player computer. Install it from python.org (on Windows, tick
  "Add python.exe to PATH"), or type its path under **Runtimes**. The Raspberry Pi image has it.
- Apps shipped as a **binary** run as they are, on the platforms their manifest names.

## Schedules

Outside its availability window an instance is stopped, its page says "not available right now", and
the show page does not list it. An instance with no schedule of its own follows the apps default
schedule; an empty schedule means always.

## Show inputs

A button or sensor can drive an app as if a visitor had tapped the phone. Boards that can call an HTTP
address on a press (Falcon and FPP controllers can) post to:

```
POST http://<player>:3000/api/ezp/inputs/<source>/<name>
```

Under **Show inputs** on the Apps card, add a row for each one: the source and name the board sends,
and the instance and input it should drive. An app declares its inputs in its manifest. The app sees the
press as an ordinary event whose source says it came from an input.

## Writing an app

The player's API for apps is small and plain HTTP. See the [Apps API](../reference/api.md#player-apps-apiezpapps)
in the reference: the manifest format, the environment an app process gets, events in, status out,
documents, and the page SDK. The tetris example in the source tree, `apps-examples/tetris/`, uses
all of it in a few hundred lines.
