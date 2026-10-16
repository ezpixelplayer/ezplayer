"""Give the Pi desktop an output even when no HDMI monitor is attached."""
from pathlib import Path
import sys

DISPLAY_MODE = 'video=HDMI-A-2:1280x720@60D'


def configure(path):
    path = Path(path)
    lines = [line.strip() for line in path.read_text().splitlines() if line.strip()]
    if len(lines) != 1:
        raise ValueError('Expected a single nonempty kernel command line; changed nothing')
    args = [arg for arg in lines[0].split() if not arg.startswith('video=HDMI-A-2:')]
    path.write_text(' '.join([*args, DISPLAY_MODE]) + '\n')


if __name__ == '__main__':
    configure(sys.argv[1])
