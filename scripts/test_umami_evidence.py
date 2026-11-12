import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile
spec = importlib.util.spec_from_file_location('scanner', Path(__file__).with_name('umami-evidence-scan.py'))
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)

class EvidenceTest(unittest.TestCase):
    def test_nested_trace_text_secret_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with zipfile.ZipFile(Path(directory) / 'trace.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('trace.trace', 'visible unlock-secret')
            self.assertFalse(scanner.scan(directory, ['unlock-secret']))
            self.assertTrue(scanner.scan(directory, ['different-secret']))
