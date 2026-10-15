#!/usr/bin/env python3
"""Serialize replication with Photon's consistent import from this database."""
import contextlib
import os
import signal
import subprocess
import time

import psycopg2

SYNC_LOCK = 704031935517
child = None


def stop(_signum, _frame):
    global child
    if child is not None and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=30)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
    raise SystemExit(0)


def run_once():
    global child
    with contextlib.closing(psycopg2.connect(dbname=os.environ.get('PGDATABASE', 'nominatim'),
                                          user='nominatim', host='/var/run/postgresql',
                                          application_name='atlas_nominatim_replication')) as connection:
        connection.autocommit = True
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_lock(%s)', (SYNC_LOCK,))
        print(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'Replication lock acquired', flush=True)
        child = subprocess.Popen(['nominatim', 'replication', '--project-dir',
                                  os.environ.get('PROJECT_DIR', '/nominatim'), '--once'])
        code = child.wait()
        child = None
        if code:
            raise RuntimeError('Replication command failed')


def main():
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    interval = max(60, int(os.environ.get('REPLICATION_RECHECK_INTERVAL', '900')))
    while True:
        try:
            run_once()
            time.sleep(interval)
        except Exception as error:
            # Do not print connection strings or subprocess argument lists.
            print('Nominatim replication retry:', type(error).__name__, flush=True)
            time.sleep(60)


if __name__ == '__main__':
    main()
