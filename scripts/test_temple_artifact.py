import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from temple_artifact import verify


class ArtifactVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.archive = self.root / 'wallet.zip'
        self.extracted = self.root / 'wallet'
        self.extracted.mkdir()
        self.files = {'manifest.json': json.dumps({'version': '1.0', 'manifest_version': 3}).encode(), 'pages/main.js': b'wallet code'}
        with zipfile.ZipFile(self.archive, 'w') as target:
            for name, content in self.files.items():
                target.writestr(name, content)
                path = self.extracted / name
                path.parent.mkdir(exist_ok=True)
                path.write_bytes(content)
        self.sha = hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def tearDown(self):
        self.temporary.cleanup()

    def test_accepts_exact_extraction(self):
        self.assertTrue(verify(self.archive, self.extracted, self.sha, '1.0')['extractedFilesMatchArchive'])

    def test_rejects_modified_extracted_code(self):
        (self.extracted / 'pages/main.js').write_bytes(b'different wallet code')
        with self.assertRaisesRegex(ValueError, 'differs'):
            verify(self.archive, self.extracted, self.sha, '1.0')

    def test_rejects_extra_file(self):
        (self.extracted / 'injected.js').write_bytes(b'extra')
        with self.assertRaisesRegex(ValueError, 'differs'):
            verify(self.archive, self.extracted, self.sha, '1.0')

    def test_rejects_missing_file(self):
        (self.extracted / 'pages/main.js').unlink()
        with self.assertRaisesRegex(ValueError, 'missing'):
            verify(self.archive, self.extracted, self.sha, '1.0')

    def test_rejects_symlink_even_with_same_content(self):
        path = self.extracted / 'pages/main.js'
        path.unlink()
        path.symlink_to(self.archive)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            verify(self.archive, self.extracted, self.sha, '1.0')

    def test_rejects_changed_archive(self):
        self.archive.write_bytes(self.archive.read_bytes() + b'changed')
        with self.assertRaisesRegex(ValueError, 'SHA256'):
            verify(self.archive, self.extracted, self.sha, '1.0')

    def test_rejects_traversal_archive(self):
        with zipfile.ZipFile(self.archive, 'a') as target:
            target.writestr('../outside.js', b'escape')
        sha = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            verify(self.archive, self.extracted, sha, '1.0')


if __name__ == '__main__':
    unittest.main()
