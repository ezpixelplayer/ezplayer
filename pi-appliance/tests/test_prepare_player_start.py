import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

SOURCE = Path(__file__).parents[1] / 'prepare_player_start.py'
spec = importlib.util.spec_from_file_location('prepare_player', SOURCE)
startup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(startup)


class StartupLocks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.show = self.home / 'Show'
        self.show.mkdir()
        config = self.home / '.config/ezplayer-ui-electron/config.json'
        config.parent.mkdir(parents=True)
        config.write_text(json.dumps({'showFolder': str(self.show)}))
        self.lock = self.show / '.ezplayer-folder.lock.lock'
        self.metadata = self.show / '.ezplayer-folder.lock'
        self.metadata.write_text('{"pid":1300}')
        (self.show / 'song.fseq').write_bytes(b'show content')

    def test_future_lock_recovers_without_touching_show_or_metadata(self):
        self.lock.mkdir()
        future = time.time() + 600
        os.utime(self.lock, (future, future))
        self.assertTrue(startup.prepare(self.home, []))
        self.assertFalse(self.lock.exists())
        self.assertEqual(self.metadata.read_text(), '{"pid":1300}')
        self.assertEqual((self.show / 'song.fseq').read_bytes(), b'show content')
        self.assertFalse(startup.prepare(self.home, []))

    def test_live_player_lock_is_never_removed(self):
        self.lock.mkdir()
        with self.assertRaises(RuntimeError):
            startup.prepare(self.home, [1234])
        self.assertTrue(self.lock.is_dir())

    def test_nonempty_lock_is_not_removed(self):
        self.lock.mkdir()
        (self.lock / 'unexpected').touch()
        with self.assertRaises(OSError):
            startup.prepare(self.home, [])
        self.assertTrue((self.lock / 'unexpected').exists())

    def test_symlink_is_not_followed(self):
        other = self.home / 'other'
        other.mkdir()
        self.lock.symlink_to(other, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            startup.prepare(self.home, [])
        self.assertTrue(other.is_dir())
        self.assertTrue(self.lock.is_symlink())

    @unittest.skipUnless(Path('/proc').is_dir(), '/proc required')
    def test_process_inspection_detects_player_command(self):
        before = set(startup.running_players())
        process = subprocess.Popen(['/opt/EZPlayer/ezplayer-ui-electron', '60'], executable='/bin/sleep')
        try:
            # /proc can expose host PIDs in a container; test detection rather
            # than assuming /proc and Popen share the same PID namespace.
            self.assertTrue(set(startup.running_players()) - before)
        finally:
            process.terminate()
            process.wait(timeout=5)

    def test_show_output_gate_accepts_ready_marker_and_times_out_without_it(self):
        marker = self.home / 'show-output.ready'
        marker.write_text('{}')
        startup.wait_for_show_output(marker, timeout=0)
        marker.unlink()
        with self.assertRaises(RuntimeError):
            startup.wait_for_show_output(marker, timeout=0)
