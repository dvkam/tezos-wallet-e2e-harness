import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from umami_artifact import verify

class UmamiArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        package=self.root/'package';(package/'DEBIAN').mkdir(parents=True)
        (package/'DEBIAN/control').write_text('Package: umami-poc-fixture\nVersion: 1.0\nArchitecture: amd64\nMaintainer: Local test <test@example.invalid>\nDescription: Public artifact validation fixture\n')
        (package/'opt/Umami/resources').mkdir(parents=True)
        (package/'opt/Umami/resources/app.asar').write_bytes(b'known public fixture bytes')
        (package/'opt/Umami/@umamidesktop').write_bytes(b'not a real executable')
        self.archive=self.root/'wallet.deb';self.directory=self.root/'extracted'
        subprocess.run(['dpkg-deb','--build',str(package),str(self.archive)],check=True,capture_output=True)
        subprocess.run(['dpkg-deb','-x',str(self.archive),str(self.directory)],check=True)
        self.config={'name':'Umami','version':'1.0','sourceCommit':'fixture','sha256':hashlib.sha256(self.archive.read_bytes()).hexdigest(),'executable':'opt/Umami/@umamidesktop'}
    def tearDown(self):self.temp.cleanup()
    def test_exact_offline_fixture_passes(self):
        self.assertTrue(verify(self.archive,self.directory,self.config)['extractedFilesMatchArchive'])
    def test_edited_asar_fails_even_when_archive_is_unchanged(self):
        (self.directory/'opt/Umami/resources/app.asar').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'extracted file changed'):verify(self.archive,self.directory,self.config)
    def test_injected_executable_file_fails(self):
        (self.directory/'opt/Umami/extra.js').write_bytes(b'extra')
        with self.assertRaisesRegex(ValueError,'Extra or missing'):verify(self.archive,self.directory,self.config)

if __name__=='__main__':unittest.main()
