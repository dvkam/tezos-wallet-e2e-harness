"""Check private run evidence without placing secret values in argv or diagnostic output."""
import json
import pathlib
import sys
import zipfile

secrets = [value.encode() for value in json.load(sys.stdin) if value]
root = pathlib.Path(sys.argv[1])
for item in root.rglob("*"):
    if not item.is_file():
        continue
    chunks = [item.read_bytes()]
    if item.suffix == ".zip":
        with zipfile.ZipFile(item) as archive:
            chunks.extend(archive.read(name) for name in archive.namelist())
    if any(secret in chunk for secret in secrets for chunk in chunks):
        print("Secret detected; evidence must remain private", file=sys.stderr)
        sys.exit(1)
print("Secret scan passed")
