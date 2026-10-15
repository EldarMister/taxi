#!/usr/bin/env python3
"""Build a checked replacement index from our Nominatim's completed import."""
import contextlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
from urllib.parse import urlencode
from urllib.request import urlopen

SYNC_LOCK = 704031935517
ROOT = Path('/data')
INDICES = ROOT / 'indices'
CURRENT = ROOT / 'current'
MARKER = 'atlas-nominatim-source.json'
child = None


def terminate(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def stop(_signum, _frame):
    if child is not None:
        terminate(child)
    raise SystemExit(0)


def atomic_json(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data), encoding='utf-8')
    temporary.replace(path)


def read_json(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def get_json(port, path):
    with urlopen(f'http://127.0.0.1:{port}{path}', timeout=5) as response:
        return json.load(response)


def source_state(connection):
    with connection.cursor() as cursor:
        cursor.execute('SELECT lastimportdate, indexed FROM import_status ORDER BY lastimportdate DESC LIMIT 1')
        row = cursor.fetchone()
    if not row or not row[1] or row[0] is None:
        raise RuntimeError('Nominatim has not completed indexing')
    return row[0].isoformat()


def java_args(command, directory):
    return ['java', '-Xms256m', '-Xmx768m', '-XX:ActiveProcessorCount=2', '-jar', '/app/photon.jar',
            command, '-data-dir', str(directory)]


def import_index(stage):
    global child
    args = java_args('import', stage) + ['-host', os.environ['PGHOST'], '-port', os.environ.get('PGPORT', '5432'),
            '-database', os.environ.get('PGDATABASE', 'nominatim'), '-user', os.environ['PGUSER'],
            '-password', os.environ['PGPASSWORD'], '-country-codes', 'kg', '-languages', 'ru,ky,en']
    child = subprocess.Popen(args)
    try:
        code = child.wait(timeout=max(60, int(os.environ.get('PHOTON_IMPORT_TIMEOUT_SECONDS', '1800'))))
    except subprocess.TimeoutExpired:
        terminate(child)
        raise RuntimeError('Photon import timed out') from None
    finally:
        child = None
    # Never include args in an exception: Photon 1.3 receives a private password argument.
    if code:
        raise RuntimeError('Photon import failed')


def same_timestamp(a, b):
    from datetime import datetime
    if not isinstance(a, str) or not isinstance(b, str):
        return False
    try:
        return datetime.fromisoformat(a.replace('Z', '+00:00')) == datetime.fromisoformat(b.replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return False


def validate(port, expected_date):
    status = get_json(port, '/status')
    if status.get('status') != 'Ok' or not same_timestamp(status.get('import_date'), expected_date):
        raise RuntimeError('Index source date does not match Nominatim')
    for query in ['Бишкек', 'Шамалды-Сай']:
        data = get_json(port, '/api?' + urlencode({'q': query, 'lang': 'ru', 'limit': 5}))
        if not any(feature.get('properties', {}).get('countrycode') == 'KG'
                   for feature in data.get('features', [])):
            raise RuntimeError('Replacement index failed search verification')


def validate_trial(stage, expected_date):
    global child
    with open('/tmp/taxi-photon-trial.log', 'w', encoding='utf-8') as log:
        child = subprocess.Popen(java_args('serve', stage) + ['-listen-ip', '127.0.0.1', '-listen-port', '8181',
                                  '-default-language', 'ru', '-query-timeout', '3', '-max-results', '20'],
                                 stdout=log, stderr=subprocess.STDOUT)
        try:
            for _ in range(90):
                if child.poll() is not None:
                    break
                try:
                    validate(8181, expected_date)
                    return
                except Exception:
                    time.sleep(2)
            raise RuntimeError('Replacement index did not pass trial verification')
        finally:
            terminate(child)
            child = None


def point_to(target):
    temporary = ROOT / 'current.next'
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target, target_is_directory=True)
    temporary.replace(CURRENT)


def restart_server():
    try:
        pid = int(Path('/tmp/taxi-photon-server.pid').read_text().strip())
        if pid > 1:
            os.kill(pid, signal.SIGTERM)
            return True
    except (FileNotFoundError, ValueError, ProcessLookupError):
        pass
    return False


def activate(stage, expected_date):
    previous = CURRENT.resolve() if CURRENT.exists() else None
    point_to(stage)
    if not restart_server():
        return previous  # Initial installation: run.sh starts the server next.
    for _ in range(60):
        try:
            validate(int(os.environ.get('PORT', '8080')), expected_date)
            return previous
        except Exception:
            time.sleep(2)
    if previous:
        point_to(previous)
        restart_server()
    raise RuntimeError('Replacement failed after switching; previous index restored')


def remove_stage(stage):
    stage = stage.resolve()
    # Delete only this manager's checked stage, never a mounted volume/current index.
    if stage.parent == INDICES.resolve() and stage.name.startswith('nominatim.') and CURRENT.resolve() != stage:
        shutil.rmtree(stage)


def sync_once():
    import psycopg2
    stage = None
    with contextlib.closing(psycopg2.connect(application_name='atlas_photon_import', connect_timeout=15)) as connection:
        connection.autocommit = True
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_lock(%s)', (SYNC_LOCK,))
        date = source_state(connection)
        if same_timestamp(read_json(CURRENT / MARKER).get('sourceDate'), date):
            atomic_json(ROOT / 'nominatim-sync-status.json', {'sourceDate': date, 'checkedAt': time.time(), 'changed': False})
            return False
        INDICES.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix='nominatim.', dir=INDICES))
        try:
            print('Importing Photon from our Nominatim:', date, flush=True)
            import_index(stage)
            if not same_timestamp(source_state(connection), date):
                raise RuntimeError('Nominatim changed during import')
            validate_trial(stage, date)
            atomic_json(stage / MARKER, {'sourceDate': date, 'builtAt': time.time(), 'languages': ['ru', 'ky', 'en']})
            previous = activate(stage, date)
            atomic_json(ROOT / 'nominatim-sync-status.json', {'sourceDate': date, 'checkedAt': time.time(), 'changed': True})
            print('Photon synchronized with Nominatim:', date, flush=True)
        except BaseException:
            if stage.exists():
                remove_stage(stage)
            raise
    # Retain the previous working index for rollback. Remove only older managed indices.
    for directory in INDICES.glob('nominatim.*'):
        if directory.is_dir() and directory.resolve() not in [CURRENT.resolve(), previous] and (directory / MARKER).is_file():
            remove_stage(directory)
    return True


def main():
    import sys
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    once = '--once' in sys.argv
    interval = max(60, int(os.environ.get('PHOTON_SYNC_INTERVAL_SECONDS', '900')))
    while True:
        try:
            sync_once()
            if once:
                return
            time.sleep(interval)
        except Exception as error:
            print('Photon synchronization retry:', type(error).__name__, flush=True)
            if once:
                raise SystemExit(1)
            time.sleep(60)


if __name__ == '__main__':
    main()
