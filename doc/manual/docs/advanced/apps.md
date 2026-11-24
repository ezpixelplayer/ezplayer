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
- a **name** and a **description** shown to visitors. The description is the place to say where to go:
  "Tetris on the big tree by the nutcracker". Blank uses the app's own words.
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
the show page does not list it. When nothing is running the show page says so in one line.

**Availability** on the Apps card holds the default windows every instance follows. Each instance can
switch to **its own windows** in its details. No windows, in either place, means always.

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

An app paints the lights through an [overlay lease](../reference/api.md#overlay-leases-apiezpoverlays).
A game opens an **exclusive** lease on its model: while it holds the lease no other game can take
that model, and a game that tries is told who has it ("Front Tree is in use by Race Front Tree"), so
two instances pointed at the same tree never paint over each other. Hold the lease only while
something is on the lights and release it between games, so the show and the other apps get the
model back. A background effect opens a **layer** instead, which blends over whatever is there and
blocks nothing.
