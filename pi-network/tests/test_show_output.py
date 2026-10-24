import importlib.util,json,pathlib,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('show',pathlib.Path(__file__).parents[1]/'show_output.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class Result:
 def __init__(self,out='',code=0):self.stdout=out;self.returncode=code
class ShowOutput(unittest.TestCase):
 def apply(self,up=True,rules=None,failure=None):
  calls=[]
  def run(*args,**kw):
   calls.append((args,kw))
   if args[:3]==('nft','list','table'):return Result(code=1)
   if args[:3]==('ip','-j','link'):return Result(json.dumps([{'flags':['UP'],'operstate':'UP' if up else 'DOWN'}]))
   if args==('ip','-j','-4','rule','show'):return Result(json.dumps(rules or []))
   if failure and args[:len(failure)]==failure:raise RuntimeError('simulated error')
   return Result()
  with tempfile.TemporaryDirectory() as d,patch.object(s,'READY',pathlib.Path(d)/'ready'),patch.object(s,'command',side_effect=run):
   try:s.apply()
   except Exception:return calls,False
   return calls,s.READY.exists()
 def test_unicast_and_multicast_share_ethernet_policy(self):
  calls,ready=self.apply();self.assertTrue(ready)
  self.assertEqual(calls[1][0],('nft','-f','-'))
  self.assertIn('oifname != "eth0"',calls[1][1]['input'])
  self.assertIn('4048, 5568',calls[1][1]['input'])
  routes=[a for a,k in calls if a[:4]==('ip','-4','route','replace')]
  self.assertTrue(any('unreachable' in a for a in routes));self.assertTrue(any('eth0' in a for a in routes))
  for port in s.PORTS:self.assertTrue(any('dport' in a and str(port) in a for a,k in calls))
  self.assertFalse(any('main' in a or 'wlan0' in a for a,k in calls))
 def test_unplugged_ethernet_has_no_default_route_fallback(self):
  calls,ready=self.apply(up=False);self.assertTrue(ready)
  self.assertTrue(any(a[:5]==('ip','-4','route','replace','unreachable') for a,k in calls))
  self.assertFalse(any(a[:5]==('ip','-4','route','replace','default') for a,k in calls))
  self.assertIn('counter drop',calls[1][1]['input'])
 def test_firewall_failure_prevents_routing_changes(self):
  calls,ready=self.apply(failure=('nft','-f'));self.assertFalse(ready)
  self.assertFalse(any(a[0]=='ip' for a,k in calls))
 def test_route_failure_keeps_firewall_and_no_ready_marker(self):
  calls,ready=self.apply(failure=('ip','-4','route'));self.assertFalse(ready)
  self.assertIn('counter drop',calls[1][1]['input'])
  self.assertFalse(any(a[:3]==('nft','delete','table') for a,k in calls))
 def test_reload_does_not_duplicate_rules(self):
  rules=[{'priority':s.PRIORITY+i,'table':s.TABLE,'ipproto':'udp','dport':p} for i,p in enumerate(s.PORTS)]
  calls,ready=self.apply(rules=rules);self.assertTrue(ready)
  self.assertFalse(any(a[:4]==('ip','-4','rule','add') for a,k in calls))
 def test_structured_port_range_is_recognized_on_reload(self):
  rules=[{'priority':s.PRIORITY+i,'table':s.TABLE,'ipproto':17,'dport':{'start':p,'end':p}} for i,p in enumerate(s.PORTS)]
  calls,ready=self.apply(rules=rules);self.assertTrue(ready)
  self.assertFalse(any(a[:4]==('ip','-4','rule','add') for a,k in calls))
 def test_foreign_priority_is_not_removed(self):
  calls,ready=self.apply(rules=[{'priority':s.PRIORITY,'table':100}]);self.assertFalse(ready)
  self.assertFalse(any(a[:4]==('ip','-4','rule','del') for a,k in calls))
 def test_firewall_reload_is_an_atomic_owned_table_only_transaction(self):
  text=s.firewall(True);self.assertTrue(text.startswith('delete table inet ezplayer_show\n'))
  self.assertNotIn('flush ruleset',text);self.assertNotIn('policy drop',text)
if __name__=='__main__':unittest.main()
