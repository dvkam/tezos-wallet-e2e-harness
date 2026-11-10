"""Acquire and verify the exact public Temple extension without trusting extracted state."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
MAX_BYTES = 512 * 1024 * 1024


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def archive_files(archive: Path) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    names: set[str] = set()
    total = 0
    with zipfile.ZipFile(archive) as source:
        if len(source.infolist()) > 10000:
            raise ValueError('Too many extension archive entries')
        for entry in source.infolist():
            name = entry.filename
            relative = PurePosixPath(name)
            if (not name or name.startswith('/') or '\\' in name or ':' in name
                    or '..' in relative.parts or '.' in relative.parts or name in names):
                raise ValueError(f'Unsafe or duplicate extension archive entry: {name!r}')
            names.add(name)
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise ValueError(f'Extension archive contains a symlink: {name}')
            if entry.is_dir():
                continue
            total += entry.file_size
            if total > MAX_BYTES:
                raise ValueError('Extension archive exceeds extraction size limit')
            files[name] = source.read(entry)
    if not files or 'manifest.json' not in files:
        raise ValueError('Extension archive lacks manifest.json')
    for name in files:
        if any(parent.as_posix() in files for parent in PurePosixPath(name).parents if parent != PurePosixPath('.')):
            raise ValueError(f'Extension archive file/directory conflict: {name}')
    return files


def verify(archive: Path, directory: Path, expected_sha256: str, version: str) -> dict:
    if archive.is_symlink() or not archive.is_file() or digest(archive) != expected_sha256:
        raise ValueError('Temple archive SHA256 does not match the selected public release')
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('Temple extension directory is absent or is a symlink')
    expected = archive_files(archive)
    actual: set[str] = set()
    for path in directory.rglob('*'):
        if path.is_symlink():
            raise ValueError(f'Extracted extension contains a symlink: {path.relative_to(directory)}')
        if path.is_file():
            name = path.relative_to(directory).as_posix()
            actual.add(name)
            if name not in expected or path.read_bytes() != expected[name]:
                raise ValueError(f'Extracted extension differs from the verified archive: {name}')
        elif not path.is_dir():
            raise ValueError(f'Extracted extension contains a special file: {path}')
    if actual != set(expected):
        raise ValueError('Extracted extension is missing archive files')
    manifest = json.loads(expected['manifest.json'])
    if manifest.get('version') != version:
        raise ValueError('Temple manifest version differs from the selected version')
    return {'version': version, 'archiveSha256': expected_sha256, 'fileCount': len(actual),
            'extractedFilesMatchArchive': True, 'manifestVersion': manifest.get('manifest_version')}


def acquire(config: dict) -> dict:
    archive = ROOT / config['archive']
    directory = ROOT / config['directory']
    archive.parent.mkdir(parents=True, exist_ok=True)
    if archive.is_symlink() or directory.is_symlink():
        raise ValueError('Refusing symlink artifact paths')
    if not archive.exists():
        descriptor, temp_name = tempfile.mkstemp(prefix='temple-download-', dir=archive.parent)
        temporary = Path(temp_name)
        try:
            request = urllib.request.Request(config['url'], headers={'User-Agent': 'beacon-local-wallet-poc'})
            with os.fdopen(descriptor, 'wb') as stream, urllib.request.urlopen(request, timeout=90) as response:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_BYTES:
                        raise ValueError('Temple download exceeds size limit')
                    stream.write(chunk)
            if digest(temporary) != config['sha256']:
                raise ValueError('Downloaded Temple release SHA256 mismatch')
            temporary.replace(archive)
        finally:
            temporary.unlink(missing_ok=True)
    if digest(archive) != config['sha256']:
        raise ValueError('Existing Temple archive SHA256 mismatch; refusing to overwrite it')
    if not directory.exists():
        temporary = Path(tempfile.mkdtemp(prefix='temple-extract-', dir=archive.parent))
        try:
            for name, content in archive_files(archive).items():
                target = temporary / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            verify(archive, temporary, config['sha256'], config['version'])
            temporary.replace(directory)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    return verify(archive, directory, config['sha256'], config['version'])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--acquire', action='store_true')
    args = parser.parse_args()
    config = json.loads((ROOT / 'baseline.json').read_text())['wallet']
    result = acquire(config) if args.acquire else verify(ROOT / config['archive'], ROOT / config['directory'], config['sha256'], config['version'])
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
