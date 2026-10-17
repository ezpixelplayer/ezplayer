import importlib.util,pathlib,tempfile,unittest
from unittest.mock import Mock,patch
spec=importlib.util.spec_from_file_location('wifi_health',pathlib.Path(__file__).parents[1]/'network_service.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class Health(unittest.TestCase):
 def hotspot(self):
  h=s.Hotspot();h.freq=5745;h.host=Mock();h.host.poll.return_value=None
  h.control_status=Mock(return_value={'state':'ENABLED','freq':'5745'});h.start=Mock()
  return h
 def test_short_missing_channel_does_not_switch_bands(self):
  h=self.hotspot();h.maintain(None,10);h.maintain(None,29);h.start.assert_not_called()
  h.maintain(5745,30);h.maintain(None,31);h.start.assert_not_called()
 def test_sustained_disconnect_restores_setup_channel(self):
  h=self.hotspot();h.maintain(None,10);h.maintain(None,30);h.start.assert_called_once_with(None)
 def test_channel_follow_requires_stable_reading(self):
  h=self.hotspot();h.maintain(5500,10);h.start.assert_not_called();h.maintain(5745,11);h.maintain(5500,12);h.start.assert_not_called();h.maintain(5500,13);h.start.assert_called_once_with(5500)
 def test_unresponsive_live_daemon_is_recovered(self):
  h=self.hotspot();h.control_status.side_effect=RuntimeError('no response')
  for now in [31,36,41]:h.maintain(5745,now)
  h.start.assert_called_once_with(5745)
 def test_transient_control_error_does_not_disconnect_clients(self):
  h=self.hotspot();h.control_status.side_effect=[RuntimeError('timeout'),{'state':'ENABLED','freq':'5745'},RuntimeError('timeout')]
  for now in [31,36,41]:h.maintain(5745,now)
  h.start.assert_not_called();self.assertEqual(h.control_failures,1)
 def test_dfs_wait_does_not_trigger_restart_loop(self):
  h=self.hotspot();h.freq=5600;h.control_status.return_value={'state':'DFS','freq':'5600'}
  for now in [30,60,300,600,650]:h.maintain(5600,now)
  h.start.assert_not_called()
 def test_disabled_daemon_gets_initialization_grace(self):
  h=self.hotspot();h.control_status.return_value={'state':'DISABLED'}
  for now in [5,10,15,20,25]:h.maintain(5745,now)
  h.start.assert_not_called()
 def test_healthy_idle_hotspot_is_not_periodically_restarted(self):
  h=self.hotspot()
  for now in range(1,1000):h.maintain(5745,now)
  h.start.assert_not_called();self.assertTrue(h.available())
 def test_dead_daemon_uses_retry_backoff(self):
  h=self.hotspot();h.host.poll.return_value=1;h.maintain(5745,1);h.start.assert_not_called();h.maintain(5745,5);h.start.assert_called_once_with(5745)
 def test_wrong_control_frequency_is_unhealthy(self):
  h=self.hotspot();h.control_status.return_value={'state':'ENABLED','freq':'5500'}
  for now in [31,36,41]:h.maintain(5745,now)
  h.start.assert_called_once_with(5745)
 def test_start_resets_ap_and_exposes_control_without_logging_secrets(self):
  h=s.Hotspot()
  with tempfile.TemporaryDirectory() as d,patch.object(s,'RUNTIME',pathlib.Path(d)),patch.object(s,'config',return_value={'ssid':'EZPLAYER','password':'privatepassword','country':'US'}),patch.object(s,'run') as run,patch.object(s.subprocess,'Popen') as popen,patch('builtins.print') as log:
   h.start(5745)
   self.assertEqual(run.call_args_list[0].args,('ip','link','set','ezsetup0','down'))
   self.assertEqual(run.call_args_list[1].args,('ip','link','set','ezsetup0','up'))
   text=(pathlib.Path(d)/'hostapd.conf').read_text();self.assertIn('ctrl_interface=',text);self.assertIn('logger_stdout_level=2',text)
   self.assertEqual((pathlib.Path(d)/'hostapd.conf').stat().st_mode&0o777,0o600)
   self.assertNotIn('privatepassword',str(log.call_args_list));self.assertNotIn('privatepassword',str(popen.call_args_list))
if __name__=='__main__':unittest.main()
