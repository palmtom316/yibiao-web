#!/usr/bin/env python3
"""Stop all application writers, then capture one database/files/config backup batch."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--env-file', required=True)
    p.add_argument('--project-name', default='yibiao-web')
    p.add_argument('--compose-file', action='append', default=[])
    p.add_argument('--destination', required=True)
    p.add_argument('--save-images', action='store_true', help='Also archive runtime images for an offline restore')
    return p


def compose(args):
    cmd = ['docker', 'compose', '-p', args.project_name, '--env-file', str(Path(args.env_file).resolve())]
    for file in args.compose_file or ['docker-compose.yml']:
        cmd += ['-f', file]
    return cmd


def sha256(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    args = parser().parse_args()
    started = time.monotonic()
    os.umask(0o077)
    backup_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    target = Path(args.destination).resolve() / backup_id
    target.mkdir(parents=True, mode=0o700)
    cmd = compose(args)
    running = subprocess.check_output(cmd + ['ps', '--services', '--status', 'running'], text=True).split()
    restart = [name for name in ['app', 'nginx'] if name in running]
    subprocess.run(cmd + ['stop', '-t', '45', 'nginx', 'app'], check=True)
    try:
        # docker stop has completed: neither HTTP nor fire-and-forget background jobs can write.
        remaining = subprocess.check_output(cmd + ['ps', '--services', '--status', 'running'], text=True).split()
        if 'app' in remaining:
            raise RuntimeError('Application still running; backup refused')
        with (target / 'database.dump').open('wb') as output:
            subprocess.run(cmd + ['exec', '-T', 'postgres', 'pg_dump', '-U', 'yibiao', '-d', 'yibiao_web', '-Fc'], stdout=output, check=True)
        with (target / 'data.tar.gz').open('wb') as output:
            subprocess.run(cmd + ['run', '-T', '--rm', '--no-deps', '--entrypoint', 'tar', 'migrate', '-C', '/data', '-czf', '-', '.'], stdout=output, check=True)
        shutil.copyfile(args.env_file, target / 'protected.env')
        resolved = json.loads(subprocess.check_output(cmd + ['config', '--format', 'json']))
        (target / 'compose-resolved.json').write_text(json.dumps(resolved, indent=2))
        images = json.loads(subprocess.check_output(cmd + ['images', '--format', 'json']) or '[]')
        retained_tags = []
        for image in images:
            service = next((name for name in ['app', 'migrate', 'nginx', 'postgres'] if image.get('ContainerName') == f'{args.project_name}-{name}-1'), None)
            if service:
                tag = f'yibiao-backup:{backup_id.lower()}-{service}'
                subprocess.run(['docker', 'image', 'tag', image['ID'], tag], check=True)
                image['backupTag'] = tag
                retained_tags.append(tag)
        if args.save_images:
            if not retained_tags:
                raise RuntimeError('No runtime images available to archive')
            subprocess.run(['docker', 'image', 'save', '-o', str(target / 'images.tar'), *retained_tags], check=True)
        (target / 'images.json').write_text(json.dumps(images, indent=2))
        migrations = subprocess.check_output(cmd + ['exec', '-T', 'postgres', 'psql', '-U', 'yibiao', '-d', 'yibiao_web', '-Atc', 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name'], text=True)
        (target / 'migrations.txt').write_text(migrations)
        file_hashes = {}
        with tarfile.open(target / 'data.tar.gz') as archive:
            for member in archive:
                if member.isfile():
                    with archive.extractfile(member) as stream:
                        file_hashes[member.name] = hashlib.file_digest(stream, 'sha256').hexdigest()
        manifest = {'backupId': backup_id, 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'dataFormatVersion': 1, 'elapsedSeconds': round(time.monotonic() - started, 3), 'writersStopped': True, 'dataFiles': file_hashes,
                    'files': {file.name: sha256(file) for file in sorted(target.iterdir()) if file.is_file()}}
        (target / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        print(f'Backup completed: {target}')
    finally:
        if restart:
            subprocess.run(cmd + ['start', *restart], check=True)


if __name__ == '__main__':
    main()
