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
import sys
import tarfile
import time

# O11：备份前预检。
# Python < 3.11 缺少本脚本使用的部分 API；目标盘必须在停止写入者之前就有足够空间，
# 否则会在停服后失败，留下「服务已停、备份未完成」的窗口。
MINIMUM_PYTHON = (3, 11)
MIN_FREE_FLOOR_BYTES = 2 * 1024 ** 3
IMAGE_ARCHIVE_RESERVE_BYTES = 2 * 1024 ** 3
DATA_COPY_FACTOR = 2.2


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


def data_bytes(cmd):
    """当前 /data 卷占用（字节）。用 migrate 镜像的 du 读取，不启动应用、不连接数据库。"""
    output = subprocess.check_output(cmd + ['run', '-T', '--rm', '--no-deps', '--entrypoint', 'du', 'migrate', '-sb', '/data'], text=True).split()
    return int(output[0])


def preflight(args, cmd):
    """在停止任何写入者之前验证运行时与目标盘空间。返回可记录进清单的预检结果。"""
    if sys.version_info < MINIMUM_PYTHON:
        raise RuntimeError(f'Python {".".join(map(str, MINIMUM_PYTHON))}+ required, found {sys.version.split()[0]}')
    destination = Path(args.destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    data = data_bytes(cmd)
    required = max(MIN_FREE_FLOOR_BYTES, int(data * DATA_COPY_FACTOR))
    if args.save_images:
        required += IMAGE_ARCHIVE_RESERVE_BYTES
    free = shutil.disk_usage(destination).free
    if free < required:
        raise RuntimeError(f'insufficient space at {destination}: data {data} bytes, need {required} bytes, free {free} bytes')
    return {'python': sys.version.split()[0], 'dataBytes': data, 'requiredFreeBytes': required, 'freeBytes': free, 'destination': str(destination)}


def main():
    args = parser().parse_args()
    started = time.monotonic()
    os.umask(0o077)
    cmd = compose(args)
    stage = 'preflight'
    backup_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    target = Path(args.destination).resolve() / backup_id
    restart = []
    try:
        # 预检必须在停服之前：空间不足、Python 版本不符时直接拒绝，不进入「已停服但没备份」的窗口。
        preflight_info = preflight(args, cmd)
        target.mkdir(parents=True, mode=0o700)
        stage = 'stop-writers'
        running = subprocess.check_output(cmd + ['ps', '--services', '--status', 'running'], text=True).split()
        restart = [name for name in ['app', 'nginx'] if name in running]
        subprocess.run(cmd + ['stop', '-t', '45', 'nginx', 'app'], check=True)
        stage = 'capture'
        # docker stop has completed: neither HTTP nor fire-and-forget background jobs can write.
        remaining = subprocess.check_output(cmd + ['ps', '--services', '--status', 'running'], text=True).split()
        if 'app' in remaining:
            raise RuntimeError('Application still running; backup refused')
        stage = 'dump-database'
        with (target / 'database.dump').open('wb') as output:
            subprocess.run(cmd + ['exec', '-T', 'postgres', 'pg_dump', '-U', 'yibiao', '-d', 'yibiao_web', '-Fc'], stdout=output, check=True)
        stage = 'archive-data'
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
        stage = 'manifest'
        manifest = {'backupId': backup_id, 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'dataFormatVersion': 1, 'elapsedSeconds': round(time.monotonic() - started, 3), 'writersStopped': True, 'preflight': preflight_info, 'dataFiles': file_hashes,
                    'files': {file.name: sha256(file) for file in sorted(target.iterdir()) if file.is_file()}}
        (target / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        print(f'Backup completed: {target}')
    except Exception as error:
        # 失败阶段必须可见：区分预检拒绝、停服失败、导出失败、归档失败，便于按阶段恢复。
        print(f'Backup failed at stage "{stage}": {error}', file=sys.stderr)
        raise SystemExit(1) from error
    finally:
        if restart:
            subprocess.run(cmd + ['start', *restart], check=True)


if __name__ == '__main__':
    main()
