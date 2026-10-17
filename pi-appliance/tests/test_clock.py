from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).parents[1]))
from pi_clock import Clock

class ClockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.clock = Clock()
        self.clock.run = Mock()
        self.clock.run.return_value.stdout = 'Timezone=America/New_York\nNTP=yes\nNTPSynchronized=no\n'

    def test_status_uses_system_time_zone_not_legacy_timezone_file(self):
        status = self.clock.status()
        self.assertEqual(status['timezone'], 'America/New_York')
        self.assertTrue(status['ntp'])
        self.assertFalse(status['synchronized'])

    def test_manual_time_converts_player_local_time_to_epoch_and_disables_ntp(self):
        self.clock.set_time('2026-01-15T20:30')
        epoch = int(datetime(2026, 1, 16, 1, 30, tzinfo=timezone.utc).timestamp())
        self.assertEqual(self.clock.run.call_args_list[-2].args, ('/usr/bin/timedatectl', 'set-ntp', 'false'))
        self.assertEqual(self.clock.run.call_args_list[-1].args, ('/usr/bin/timedatectl', 'set-time', '@' + str(epoch)))

    def test_invalid_and_dst_ambiguous_times_cannot_change_clock(self):
        for value in ['bad', '2026-02-30T10:00', '2010-01-01T00:00', '2026-03-08T02:30', '2026-11-01T01:30', '2026-01-01T12:00;reboot']:
            with self.assertRaises(ValueError):
                self.clock.set_time(value)
        self.assertFalse(any(c.args[1] == 'set-time' for c in self.clock.run.call_args_list))

    def test_invalid_ntp_values_are_rejected(self):
        with self.assertRaises(ValueError): self.clock.set_ntp('false')
        self.clock.run.assert_not_called()
