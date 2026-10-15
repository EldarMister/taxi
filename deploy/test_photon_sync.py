"""Deployment guarantees for our Nominatim -> Photon index replacement."""
import ast
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('photon_sync', ROOT / 'photon/sync.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)
DATE = '2026-10-13T20:21:31+00:00'


class Connection:
    autocommit = False
    closed = False

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def execute(self, query, params=None):
        self.last_query = query
        self.last_params = params

    def close(self):
        self.closed = True


class PhotonSyncTest(unittest.TestCase):
    def test_both_workers_use_the_same_database_lock(self):
        tree = ast.parse((ROOT / 'nominatim/replication.py').read_text(encoding='utf-8'))
        lock = next(node.value.value for node in tree.body if isinstance(node, ast.Assign)
                    and any(isinstance(t, ast.Name) and t.id == 'SYNC_LOCK' for t in node.targets))
        self.assertEqual(lock, sync.SYNC_LOCK)

    def test_unchanged_source_does_not_rebuild(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current = root / 'current'
            current.mkdir()
            (current / sync.MARKER).write_text(json.dumps({'sourceDate': DATE}))
            connection = Connection()
            with patch.object(sync, 'ROOT', root), patch.object(sync, 'CURRENT', current), \
                    patch.object(sync, 'source_state', return_value=DATE), \
                    patch.object(sync, 'import_index') as importer, \
                    patch.dict(sys.modules, {'psycopg2': SimpleNamespace(connect=lambda **kw: connection)}):
                self.assertFalse(sync.sync_once())
            importer.assert_not_called()
            self.assertTrue(connection.closed)
            self.assertEqual(connection.last_params, (sync.SYNC_LOCK,))

    def test_changed_source_builds_separate_candidate_and_retains_previous_index(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current = root / 'old-index'
            current.mkdir()
            connection = Connection()
            built = []

            def importer(stage):
                self.assertFalse(connection.closed)
                self.assertNotEqual(stage, current)
                self.assertTrue(stage.name.startswith('nominatim.'))
                built.append(stage)

            def activate(stage, date):
                self.assertTrue((stage / sync.MARKER).exists())
                sync.CURRENT = stage
                return current

            with patch.object(sync, 'ROOT', root), patch.object(sync, 'INDICES', root / 'indices'), \
                    patch.object(sync, 'CURRENT', current), patch.object(sync, 'source_state', return_value=DATE), \
                    patch.object(sync, 'import_index', side_effect=importer), \
                    patch.object(sync, 'validate_trial') as verify, patch.object(sync, 'activate', side_effect=activate), \
                    patch.dict(sys.modules, {'psycopg2': SimpleNamespace(connect=lambda **kw: connection)}):
                self.assertTrue(sync.sync_once())
            verify.assert_called_once_with(built[0], DATE)
            self.assertTrue(current.is_dir())
            self.assertTrue(built[0].is_dir())

    def test_failed_import_preserves_current_and_cleans_only_its_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current = root / 'old-index'
            current.mkdir()
            with patch.object(sync, 'ROOT', root), patch.object(sync, 'INDICES', root / 'indices'), \
                    patch.object(sync, 'CURRENT', current), patch.object(sync, 'source_state', return_value=DATE), \
                    patch.object(sync, 'import_index', side_effect=RuntimeError('failed')), \
                    patch.object(sync, 'activate') as activate, \
                    patch.dict(sys.modules, {'psycopg2': SimpleNamespace(connect=lambda **kw: Connection())}):
                with self.assertRaises(RuntimeError):
                    sync.sync_once()
            activate.assert_not_called()
            self.assertTrue(current.is_dir())
            self.assertEqual(list((root / 'indices').iterdir()), [])

    def test_failed_live_check_restores_previous_index(self):
        with tempfile.TemporaryDirectory() as directory:
            current = Path(directory) / 'old'
            current.mkdir()
            candidate = Path(directory) / 'candidate'
            with patch.object(sync, 'CURRENT', current), patch.object(sync, 'point_to') as point_to, \
                    patch.object(sync, 'restart_server', return_value=True) as restart, \
                    patch.object(sync, 'validate', side_effect=RuntimeError('unhealthy')), patch.object(sync.time, 'sleep'):
                with self.assertRaises(RuntimeError):
                    sync.activate(candidate, DATE)
            self.assertEqual([c.args[0] for c in point_to.call_args_list], [candidate, current.resolve()])
            self.assertEqual(restart.call_count, 2)

    def test_failed_command_does_not_expose_the_password_in_exception(self):
        process = Mock()
        process.wait.return_value = 1
        with patch.dict('os.environ', {'PGHOST': 'private', 'PGUSER': 'reader', 'PGPASSWORD': 'hidden-password'}), \
                patch.object(sync.subprocess, 'Popen', return_value=process):
            with self.assertRaises(RuntimeError) as error:
                sync.import_index(Path('/data/indices/candidate'))
            self.assertNotIn('hidden-password', str(error.exception))

    def test_validation_requires_current_source_date_and_country_results(self):
        with patch.object(sync, 'get_json', side_effect=[{'status': 'Ok', 'import_date': DATE}, {'features': []}]):
            with self.assertRaises(RuntimeError):
                sync.validate(8181, DATE)
        self.assertTrue(sync.same_timestamp(DATE, '2026-10-13T20:21:31Z'))
        self.assertFalse(sync.same_timestamp(None, DATE))

    def test_timed_out_import_stops_before_releasing_the_database_lock(self):
        process = Mock()
        process.poll.return_value = None
        process.wait.side_effect = [sync.subprocess.TimeoutExpired('private-arguments', 1800), 0]
        with patch.dict('os.environ', {'PGHOST': 'private', 'PGUSER': 'reader', 'PGPASSWORD': 'hidden-password'}), \
                patch.object(sync.subprocess, 'Popen', return_value=process):
            with self.assertRaisesRegex(RuntimeError, 'timed out'):
                sync.import_index(Path('/data/indices/candidate'))
        process.terminate.assert_called_once()
        self.assertIsNone(sync.child)


if __name__ == '__main__':
    unittest.main()
