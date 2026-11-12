import json
import pathlib
import subprocess
import tempfile
import unittest
import zipfile

class EvidenceScanTest(unittest.TestCase):
    def test_rejects_secret_in_measurement_or_trace_resources_without_printing_it(self):
        secret = "ephemeral-test-secret"
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            def scan():
                return subprocess.run(["python3", "scripts/scan-wallet-evidence.py", directory],
                    input=json.dumps([secret]), capture_output=True, text=True)
            self.assertEqual(scan().returncode, 0)
            measurement = root / "measurement.json"
            measurement.write_text(json.dumps({"health": {"detail": secret}}))
            result = scan()
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(secret, result.stdout + result.stderr)
            measurement.unlink()
            with zipfile.ZipFile(root / "trace.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("resources/snapshot", secret)
            result = scan()
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(secret, result.stdout + result.stderr)
