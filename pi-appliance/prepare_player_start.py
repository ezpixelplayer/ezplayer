"""Pi-only startup preflight; recover orphaned show locks without wall-clock tests."""
import json
import os
from pathlib import Path
import stat
import time


def running_players():
    """Inspect this user's processes; an existing player keeps its lock."""
    found = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if entry.stat().st_uid != os.getuid():
                continue
            argv = (entry / 'cmdline').read_bytes().split(b'\0')
            if argv and Path(os.fsdecode(argv[0])).name == 'ezplayer-ui-electron':
                found.append(int(entry.name))
        except (FileNotFoundError, ProcessLookupError):
            continue  # A process exited during inspection.
    return found


def prepare(home, active_players=None):
    settings_path = Path(home) / '.config/ezplayer-ui-electron/config.json'
    if not settings_path.exists():
        return False
    settings = json.loads(settings_path.read_text())
    folder = settings.get('showFolder')
    if not folder:
        return False
    if not isinstance(folder, str) or not Path(folder).is_absolute():
        raise ValueError('Invalid show-folder setting; startup preflight changed nothing')
    players = running_players() if active_players is None else active_players
    if players:
        raise RuntimeError(f'Another EZPlayer process is running ({players}); leaving show lock untouched')
    lock = Path(folder) / '.ezplayer-folder.lock.lock'
    try:
        info = lock.lstat()
    except FileNotFoundError:
        return False
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise RuntimeError('Unexpected show-lock type or owner; leaving it untouched')
    # All appliances run the player as one unprivileged user. The service serializes
    # its own starts; do not remove locks until that user's players are gone.
    # rmdir refuses nonempty directories. Never remove the metadata/show files.
    lock.rmdir()
    print(f'Removed orphaned show-lock directory before player startup: {lock}; previous mtime={info.st_mtime}', flush=True)
    return True


def wait_for_show_output(path=Path('/run/ezplayer-show-output.ready'), timeout=90):
    """Keep image playback behind the system routing/firewall setup."""
    deadline = time.monotonic() + timeout
    while not path.is_file():
        if time.monotonic() >= deadline:
            raise RuntimeError('Show-output network policy did not become ready')
        time.sleep(0.25)


if __name__ == '__main__':
    prepare(Path.home())
    if os.environ.get('EZPLAYER_WAIT_FOR_SHOW_OUTPUT') == '1':
        wait_for_show_output()
