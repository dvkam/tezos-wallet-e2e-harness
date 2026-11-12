"""Verify the official Umami Debian artifact and its complete extracted filesystem."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT=Path(__file__).resolve().parent.parent

def digest(stream):
    value=hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024*1024),b''): value.update(chunk)
    return value.hexdigest()

def file_digest(path):
    with path.open('rb') as stream: return digest(stream)

def safe_name(value):
    path=PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts: raise ValueError('Unsafe Debian archive path')
    return path.as_posix().removeprefix('./')

def verify(archive:Path,directory:Path,config:dict):
    if archive.is_symlink() or file_digest(archive)!=config['sha256']: raise ValueError('Umami archive SHA256 mismatch')
    if directory.is_symlink() or not directory.is_dir(): raise ValueError('Umami extracted directory missing or linked')
    expected={}
    hardlinks=[]
    process=subprocess.Popen(['dpkg-deb','--fsys-tarfile',str(archive)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=process.stdout,mode='r|') as source:
            for entry in source:
                name=safe_name(entry.name)
                if name in ('.',''):continue
                target=directory/name
                if entry.isdir():
                    if target.is_symlink() or not target.is_dir(): raise ValueError('Umami directory changed: '+name)
                    continue
                if name in expected:raise ValueError('Duplicate Umami archive entry')
                if entry.issym():
                    if not target.is_symlink() or os.readlink(target)!=entry.linkname:raise ValueError('Umami symlink changed: '+name)
                    expected[name]={'type':'symlink','target':entry.linkname}
                elif entry.islnk():
                    hardlinks.append((name,safe_name(entry.linkname)))
                elif entry.isfile():
                    stream=source.extractfile(entry)
                    if stream is None:raise ValueError('Missing Umami archive data: '+name)
                    expected_hash=digest(stream)
                    if target.is_symlink() or not target.is_file() or file_digest(target)!=expected_hash:raise ValueError('Umami extracted file changed: '+name)
                    expected[name]={'type':'file','sha256':expected_hash}
                else:raise ValueError('Unsupported Umami archive entry: '+name)
        for name,link in hardlinks:
            if link not in expected or expected[link]['type']!='file':raise ValueError('Unsupported Umami hard link: '+name)
            target=directory/name
            if target.is_symlink() or not target.is_file() or file_digest(target)!=expected[link]['sha256']:raise ValueError('Umami hard link content changed: '+name)
            expected[name]={'type':'file','sha256':expected[link]['sha256']}
        stderr=process.communicate(timeout=10)[1]
        if process.returncode!=0:raise ValueError('Cannot read Umami archive: '+stderr.decode(errors='replace'))
    finally:
        if process.poll() is None:process.kill();process.wait()
        if process.stdout is not None:process.stdout.close()
        if process.stderr is not None:process.stderr.close()
    actual=set()
    for entry in directory.rglob('*'):
        if entry.is_symlink() or entry.is_file():actual.add(entry.relative_to(directory).as_posix())
        elif not entry.is_dir():raise ValueError('Unsupported extracted Umami filesystem entry')
    if actual!=set(expected):raise ValueError('Extra or missing Umami extracted files')
    tree=hashlib.sha256(json.dumps(expected,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return {'name':config['name'],'version':config['version'],'sourceCommit':config['sourceCommit'],'archiveSha256':config['sha256'],'extractedFileCount':len(expected),'extractedTreeSha256':tree,'extractedFilesMatchArchive':True,'executableSha256':file_digest(directory/config['executable'])}

def acquire(config):
    artifact_root=Path(os.environ.get('WALLET_ARTIFACT_ROOT', str(ROOT/'.artifacts')))
    archive=artifact_root/'umami'/Path(config['archive']).name; directory=artifact_root/'umami/unpacked'
    archive.parent.mkdir(parents=True,exist_ok=True)
    if archive.is_symlink() or directory.is_symlink():raise ValueError('Refusing symlinked Umami artifact path')
    if not archive.exists():
        fd,name=tempfile.mkstemp(prefix='umami-download-',dir=archive.parent);temporary=Path(name)
        try:
            with os.fdopen(fd,'wb') as stream,urllib.request.urlopen(config['url'],timeout=120) as response:
                count=0
                while chunk:=response.read(1024*1024):
                    count+=len(chunk)
                    if count>512*1024*1024:raise ValueError('Umami archive exceeds size limit')
                    stream.write(chunk)
            if file_digest(temporary)!=config['sha256']:raise ValueError('Downloaded Umami SHA256 mismatch')
            temporary.replace(archive)
        finally:temporary.unlink(missing_ok=True)
    if file_digest(archive)!=config['sha256']:raise ValueError('Existing Umami archive SHA256 mismatch')
    if not directory.exists():
        temporary=Path(tempfile.mkdtemp(prefix='umami-extract-',dir=archive.parent))
        try:
            subprocess.run(['dpkg-deb','-x',str(archive),str(temporary)],check=True)
            verify(archive,temporary,config)
            temporary.replace(directory)
        finally:
            if temporary.exists():shutil.rmtree(temporary)
    return verify(archive,directory,config)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--acquire',action='store_true');args=parser.parse_args()
    config=json.loads((ROOT/'fixtures/umami.json').read_text())
    artifact_root=Path(os.environ.get('WALLET_ARTIFACT_ROOT', str(ROOT/'.artifacts')))
    print(json.dumps(acquire(config) if args.acquire else verify(artifact_root/'umami'/Path(config['archive']).name,artifact_root/'umami/unpacked',config),indent=2))
