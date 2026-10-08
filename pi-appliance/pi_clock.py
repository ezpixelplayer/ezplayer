"""Bounded system-clock controls; hardware clock management is left to Raspberry Pi OS."""
from datetime import datetime, timezone
import re
import subprocess
from zoneinfo import ZoneInfo, available_timezones

class Clock:
    def run(self, *args):
        return subprocess.run(list(args), check=True, capture_output=True, text=True, timeout=10)

    def status(self):
        result = self.run('/usr/bin/timedatectl', 'show', '--property=Timezone', '--property=NTP', '--property=NTPSynchronized')
        props = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
        zone = props.get('Timezone', 'UTC')
        return {'timezone': zone, 'time': datetime.now(ZoneInfo(zone)).isoformat(timespec='seconds'),
                'ntp': props.get('NTP') == 'yes', 'synchronized': props.get('NTPSynchronized') == 'yes'}

    def set_timezone(self, zone):
        if not isinstance(zone, str) or zone not in available_timezones():
            raise ValueError('Choose a valid time zone')
        self.run('/usr/bin/timedatectl', 'set-timezone', zone)
        return {'ok': True}

    def set_ntp(self, enabled):
        if type(enabled) is not bool:
            raise ValueError('Invalid internet time setting')
        self.run('/usr/bin/timedatectl', 'set-ntp', 'true' if enabled else 'false')
        return {'ok': True}

    def set_time(self, value):
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?', value):
            raise ValueError('Enter a valid local date and time')
        try:
            local = datetime.fromisoformat(value)
        except ValueError:
            raise ValueError('Enter a valid local date and time') from None
        if not 2020 <= local.year <= 2099:
            raise ValueError('Year must be between 2020 and 2099')
        zone = ZoneInfo(self.status()['timezone'])
        first, second = local.replace(tzinfo=zone, fold=0), local.replace(tzinfo=zone, fold=1)
        if first.utcoffset() != second.utcoffset() or first.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != local:
            raise ValueError('This local time is skipped or repeated by daylight saving; choose another time')
        # Use an explicit UTC epoch: browser and player can have different time zones.
        self.run('/usr/bin/timedatectl', 'set-ntp', 'false')
        self.run('/usr/bin/timedatectl', 'set-time', '@' + str(int(first.timestamp())))
        return {'ok': True}
