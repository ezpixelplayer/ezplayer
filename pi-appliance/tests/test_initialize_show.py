import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).parents[1]))
from initialize_show import initialize

class InstallShowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.store = self.home / '.config/EZPlayer/config.json'

    def test_first_install_seeds_valid_show_and_persistent_selection(self):
        folder = Path(initialize(self.home))
        self.assertTrue(folder.is_dir())
        self.assertEqual(json.loads(self.store.read_text())['showFolder'], str(folder))
        cloud_path = folder / '.ezplayer/cloud-config.json'
        original = cloud_path.read_text()
        self.assertEqual(json.loads(original)['layoutSource'], 'cloud')
        self.assertEqual(initialize(self.home), str(folder))
        self.assertEqual(cloud_path.read_text(), original)

    def test_existing_selection_and_preferences_are_untouched(self):
        self.store.parent.mkdir(parents=True)
        original = '{"showFolder":"/home/ezplayer/existing-show", "otherPreference":true}'
        self.store.write_text(original)
        self.assertEqual(initialize(self.home), '/home/ezplayer/existing-show')
        self.assertEqual(self.store.read_text(), original)
        self.assertFalse((self.home / 'EZPlayer/Show').exists())

    def test_existing_preferences_are_preserved_when_no_folder_selected(self):
        self.store.parent.mkdir(parents=True)
        self.store.write_text('{"otherPreference":true}')
        initialize(self.home)
        self.assertTrue(json.loads(self.store.read_text())['otherPreference'])
        self.assertEqual(self.store.stat().st_mode & 0o777, 0o600)

    def test_invalid_existing_settings_are_not_overwritten(self):
        self.store.parent.mkdir(parents=True)
        self.store.write_text('broken json')
        with self.assertRaises(ValueError): initialize(self.home)
        self.assertEqual(self.store.read_text(), 'broken json')
