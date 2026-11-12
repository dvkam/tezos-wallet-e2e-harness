"""Detect literal supplied secrets in retained text/ZIP evidence; not an image OCR proof."""
import json
from pathlib import Path
import sys
import zipfile

def scan(root, secrets):
    needles = [value.encode() for value in secrets if value]
    def check(body):
        return any(needle in body for needle in needles)
    for file in Path(root).rglob('*'):
        if not file.is_file():
            continue
        if check(file.read_bytes()):
            return False
        if zipfile.is_zipfile(file):
            with zipfile.ZipFile(file) as archive:
                for entry in archive.infolist():
                    if check(archive.read(entry)):
                        return False
    return True

if __name__ == '__main__':
    secrets = json.load(sys.stdin)
    if not isinstance(secrets, list) or not all(isinstance(value, str) for value in secrets):
        raise ValueError('Expected secret strings on stdin')
    result = scan(sys.argv[1], secrets)
    print(json.dumps({'status': 'passed' if result else 'failed', 'scope': 'literal-text-and-zip-entries-no-OCR'}))
    sys.exit(0 if result else 1)
