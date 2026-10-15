"""Validate staging without mounting/building a rootfs in the test process."""
import importlib.util,json,pathlib,shutil,subprocess,tempfile,unittest
ROOT=pathlib.Path(__file__).parents[2]
spec=importlib.util.spec_from_file_location('image_initialize',ROOT/'pi-appliance/initialize_show.py');initializer=importlib.util.module_from_spec(spec);spec.loader.exec_module(initializer)
class ImageStaging(unittest.TestCase):
 @unittest.skipUnless(shutil.which('dpkg-deb'),'dpkg-deb required')
 def test_stage_contains_matching_network_stack_and_firstboot(self):
  with tempfile.TemporaryDirectory() as tmp:
   tmp=pathlib.Path(tmp);package=tmp/'package';(package/'DEBIAN').mkdir(parents=True)
   (package/'DEBIAN/control').write_text('Package: ezplayer-image-fixture\nVersion: 1.0\nArchitecture: arm64\nMaintainer: Test <test@example.invalid>\nDescription: stage test fixture\n')
   deb=tmp/'fixture.deb';subprocess.run(['dpkg-deb','--build','--root-owner-group',str(package),str(deb)],check=True,capture_output=True)
   pigen=tmp/'pi-gen';(pigen/'stage4').mkdir(parents=True);(pigen/'build.sh').touch()
   subprocess.run(['bash',str(ROOT/'pi-appliance/prepare-pi-gen.sh'),str(pigen),str(deb)],check=True,capture_output=True)
   staged=pigen/'stage-ezplayer/00-ezplayer/files'
   for relative in ['network_service.py','show_output.py','portal/index.html','portal/login.html','ezplayer-web.conf','image-firstboot.sh','ezplayer-image-firstboot.service','install-image.sh']:
    self.assertEqual((staged/'network'/relative).read_bytes(),(ROOT/'pi-network'/relative).read_bytes())
   self.assertTrue((staged/'ezplayer-pi.deb').is_file());self.assertFalse(list((staged/'network').rglob('*.pyc')))
   self.assertTrue((pigen/'stage-ezplayer/prerun.sh').stat().st_mode&0o111)
 def test_device_identities_are_generated_independently_and_survive_reboot(self):
  with tempfile.TemporaryDirectory() as tmp:
   homes=[pathlib.Path(tmp)/'pi1',pathlib.Path(tmp)/'pi2'];tokens=[]
   for home in homes:
    folder=pathlib.Path(initializer.initialize(home));cloud=folder/'.ezplayer/cloud-config.json';token=json.loads(cloud.read_text())['playerIdToken'];tokens.append(token)
    initializer.initialize(home);self.assertEqual(json.loads(cloud.read_text())['playerIdToken'],token)
   self.assertNotEqual(*tokens)
 def test_scripts_parse(self):
  scripts=[ROOT/'pi-appliance/build-test-image.sh',ROOT/'pi-appliance/prepare-pi-gen.sh',ROOT/'pi-appliance/install-pi.sh',ROOT/'pi-appliance/pi-gen-stage/00-ezplayer/00-run.sh',ROOT/'pi-network/install-image.sh',ROOT/'pi-network/image-firstboot.sh']
  for script in scripts:subprocess.run(['bash','-n',str(script)],check=True,capture_output=True)
