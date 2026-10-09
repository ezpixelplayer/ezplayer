"""First-install show folder setup, run by the installer as the desktop user."""
import json
import os
from pathlib import Path
import uuid

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with open(temporary, 'x', opener=lambda p, flags: os.open(p, flags, 0o600)) as out:
            json.dump(value, out, indent=2)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

def initialize(home, config_dir=None):
    home = Path(home)
    # Packaged app productName is EZPlayer; electron-store uses userData/config.json.
    store_path = Path(config_dir or home / '.config' / 'EZPlayer') / 'config.json'
    settings = json.loads(store_path.read_text()) if store_path.exists() else {}
    if not isinstance(settings, dict):
        raise ValueError('Existing EZPlayer settings are invalid; no settings were changed')
    if settings.get('showFolder'):
        return settings['showFolder']  # Preserve existing selection and all preferences.
    folder = home / 'EZPlayer' / 'Show'
    folder.mkdir(parents=True, exist_ok=True)
    cloud_path = folder / '.ezplayer' / 'cloud-config.json'
    if not cloud_path.exists():
        write_json(cloud_path, {'cloudServiceUrl': 'https://api.ezplayer.dev/',
                               'playerIdToken': str(uuid.uuid4()), 'layoutSource': 'cloud'})
    else:
        cloud = json.loads(cloud_path.read_text())
        if cloud.get('layoutSource') != 'cloud':
            raise ValueError('Existing managed folder is not cloud-configured; select it in EZPlayer without overwriting it')
    write_json(store_path, {**settings, 'showFolder': str(folder)})
    return str(folder)

if __name__ == '__main__':
    home = Path.home()
    config_dir = Path(os.environ.get('XDG_CONFIG_HOME', str(home / '.config'))) / 'EZPlayer'
    print('Show folder: ' + initialize(home, config_dir))
