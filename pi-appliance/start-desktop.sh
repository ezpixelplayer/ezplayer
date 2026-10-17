#!/bin/bash
set -euo pipefail
systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XAUTHORITY XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS XDG_SESSION_TYPE XDG_CURRENT_DESKTOP
systemctl --user daemon-reload
systemctl --user start ezplayer-desktop.service
