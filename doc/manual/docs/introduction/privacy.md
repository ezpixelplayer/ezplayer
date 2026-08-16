---
sidebar_position: 2
title: Privacy
---

# Privacy

EZPlayer is designed so you always know what leaves your machine, and why.
The short version:

1. **EZPlayer works without internet access, and in that case it is
   completely private.** Nothing is collected, nothing is sent. Your show
   folder, sequences, layout, and settings live on your machine.

2. **The desktop app can send anonymous crash and diagnostic reports.**
   This helps us find and fix problems, and it is **on by default — you can
   opt out** in Settings → Player → Diagnostics. Reports contain the error
   or crash details (message, stack trace), the app version, and the
   operating system and architecture. They never contain your show data,
   files, or personal information. A second, separate checkbox — **off by
   default** — lets you include your Player ID with reports, so support can
   connect a report to your player when you ask for help.

3. **When you sign in to the cloud service, cloud-side privacy is governed
   by the policy of the cloud provider** (EZRGB, or whichever provider you
   connect to), not by EZPlayer. What you upload — layouts, sequences, show
   settings, viewer pages — is handled under that provider's terms.

4. **Cloud remote control is capability-based: anyone who has your Player
   ID can control your player.** The remote-control link contains the
   Player ID, which is the entire credential — that is what makes "send a
   link to a helper" work with no accounts or sign-in. Treat the link like
   a key. If you believe it is in the hands of someone who should not have
   it, use **Change Player ID** on the player's Cloud screen: one click
   generates a new ID, moves your registration to it, and every old link or
   QR code stops working immediately. EZPlayer and its developers are not
   responsible or liable for any consequences of sharing your Player ID or
   control link.

## Where things are stored

- **Show data** (sequences, layout, playlists, schedules, settings) — your
  show folder, on your machine.
- **Crash dumps** — `~/ezplay-dumps` on your machine; these are not
  uploaded.
- **Diagnostics consent** — stored app-wide on the machine, so it applies
  across show folders and survives reinstalls of a show.
- **Cloud data** — whatever you have chosen to sync or publish, on the
  cloud provider's infrastructure, under its policy.
