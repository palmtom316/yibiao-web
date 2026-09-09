#!/usr/bin/env python3
"""Restore a verified backup to an EMPTY separate environment; never erase an existing deployment."""
import argparse
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import time
from backup import compose, sha256


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--env-file', required=True)
    p.add_argument('--project-name', required=True)
    p.add_argument('--compose-file', action='append', default=[])
    p.add_argument('--backup', required=True)
    args = p.parse_args()
    started = time.monotonic()
    source = Path(args.backup).resolve()
    manifest = json.loads((source / 'manifest.json').read_text())
    if not manifest.get('writersStopped') or not manifest.get('backupId'):
        raise RuntimeError('Backup consistency manifest missing')
    for name, expected in manifest['files'].items():
        if Path(name).name != name or sha256(source / name) != expected:
            raise RuntimeError(f'Backup checksum mismatch: {name}')
    with tarfile.open(source / 'data.tar.gz') as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise RuntimeError('Unsafe member in backup data archive')
    cmd = compose(args)
    running = subprocess.check_output(cmd + ['ps', '--services', '--status', 'running'], text=True).split()
    if 'app' in running:
        raise RuntimeError('Target app must be stopped. Preserve existing deployment and use a new project/volumes.')
    if 'images.tar' in manifest['files']:
        subprocess.run(['docker', 'image', 'load', '-i', str(source / 'images.tar')], check=True)
    subprocess.run(cmd + ['up', '-d', '--wait', 'postgres'], check=True)
    count = subprocess.check_output(cmd + ['exec', '-T', 'postgres', 'psql', '-U', 'yibiao', '-d', 'yibiao_web', '-Atc', "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"], text=True).strip()
    if count != '0':
        raise RuntimeError('Target database is not empty; no data changed')
    subprocess.run(cmd + ['run', '-T', '--rm', '--no-deps', '--entrypoint', 'node', 'migrate', '-e', "if(require('fs').readdirSync('/data').length)process.exit(1)"], check=True)
    with (source / 'database.dump').open('rb') as dump:
        subprocess.run(cmd + ['exec', '-T', 'postgres', 'pg_restore', '-U', 'yibiao', '-d', 'yibiao_web', '--no-owner', '--exit-on-error'], stdin=dump, check=True)
    with (source / 'data.tar.gz').open('rb') as archive:
        subprocess.run(cmd + ['run', '-T', '--rm', '--no-deps', '--entrypoint', 'tar', 'migrate', '-C', '/data', '-xzf', '-'], stdin=archive, check=True)
    verifier = """const fs=require('fs'),path=require('path'),crypto=require('crypto');
const manifest=JSON.parse(fs.readFileSync(0,'utf8'));
for(const [relative,expected] of Object.entries(manifest.dataFiles)) {
 const file=path.resolve('/data',relative);
 if(!file.startsWith('/data/'))throw Error('Invalid manifest path');
 const actual=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 if(actual!==expected)throw Error('Restored data checksum mismatch');
}
console.log(JSON.stringify({restoredFiles:Object.keys(manifest.dataFiles).length,hashes:'passed'}));"""
    subprocess.run(cmd + ['run', '-T', '--rm', '--no-deps', '--entrypoint', 'node', 'migrate', '-e', verifier], input=json.dumps(manifest), text=True, check=True)
    print(json.dumps({'backupId': manifest['backupId'], 'elapsedSeconds': round(time.monotonic() - started, 3), 'status': 'restored-and-verified', 'app': 'stopped'}))


if __name__ == '__main__':
    main()
