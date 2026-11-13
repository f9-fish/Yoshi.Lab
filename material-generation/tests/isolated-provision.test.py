"""Offline only: fake Cloud boundary; never invokes a cloud CLI or Gemini."""
import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('provision', Path(__file__).resolve().parents[1] / 'ops/isolated-project/provision.py')
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)
PID = 'yoshilab-material-ai-abcd'
NUM = '123456789012'
EMAIL = 'material-ai-auth@' + PID + '.iam.gserviceaccount.com'
MEMBER = 'user:admin@example.invalid'
KR = 'projects/' + NUM + '/locations/global/keys/material-ai-gemini'
PRIVATE = 'NEVER_PRINT_NEW_KEY_1234567890'

class FakeCloud:
    project = PID
    def __init__(self, existing=False, fail=None):
        self.calls, self.existing, self.fail = [], existing, fail
        self.created = False
        self.billing = True
        self.public = False
        self.key_mismatch = False
        self.bucket_mismatch = False
        self.sa_exists = False
        self.age = 0
        self.grants = {'project': [], 'bucket': [], 'secret': []}
    def call(self, args, data=None):
        self.calls.append((args, data))
        if self.fail and self.fail(args):
            raise P.Stop('CLOUD_COMMAND_FAILED')
        if args[:2] == ['projects', 'describe']:
            return {'projectId': PID, 'projectNumber': NUM, 'lifecycleState': 'ACTIVE',
                    'createTime': (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=self.age)).isoformat()}
        if args[:3] == ['billing', 'projects', 'describe']:
            return {'billingEnabled': self.billing}
        if args[:2] == ['auth', 'list']:
            return [{'account': 'admin@example.invalid'}]
        if args[:2] == ['services', 'list']:
            return [{'config': {'name': a}} for a in P.APIS]
        if args[:3] in (['services', 'api-keys', 'list'], ['secrets', 'list'], ['storage', 'buckets', 'list'], ['iam', 'roles', 'list']):
            return [{'name': 'existing'}] if self.existing else []
        if args[:3] == ['iam', 'service-accounts', 'list']:
            return [{'email': EMAIL}] if self.sa_exists else []
        if args[:3] == ['storage', 'buckets', 'create']:
            self.created = True
        if args[:3] in (['services', 'api-keys', 'create'], ['services', 'api-keys', 'get-key-string']):
            return {'keyString': PRIVATE}
        if args[:3] == ['services', 'api-keys', 'describe']:
            return {'name': KR if not self.key_mismatch else 'other', 'serviceAccountEmail': EMAIL,
                    'restrictions': {'apiTargets': [{'service': 'generativelanguage.googleapis.com'}]}}
        if args[:3] == ['secrets', 'versions', 'add']:
            assert data == PRIVATE
            return {'name': 'projects/' + NUM + '/secrets/material-ai-gemini/versions/1'}
        if args[:2] == ['secrets', 'describe']:
            return {'name': 'projects/' + NUM + '/secrets/material-ai-gemini', 'labels': {'material-ai': 'isolated-v1'}}
        if args[:3] == ['secrets', 'versions', 'list']:
            return [{'name': 'projects/' + NUM + '/secrets/material-ai-gemini/versions/1', 'state': 'ENABLED'}]
        if args[:3] == ['iam', 'service-accounts', 'describe']:
            return {'email': EMAIL}
        if args[:3] == ['storage', 'buckets', 'describe']:
            assert '--raw' in args
            return {'name': PID + '-validation', 'projectNumber': NUM if not self.bucket_mismatch else '999999999999',
                    'location': 'ASIA-NORTHEAST1', 'iamConfiguration': {'uniformBucketLevelAccess': {'enabled': True}, 'publicAccessPrevention': 'enforced'}}
        if args[:3] == ['iam', 'roles', 'describe']:
            return {'includedPermissions': P.ROLES[args[3]], 'stage': 'GA'}
        kind = 'project' if args[0] == 'projects' else ('bucket' if args[0] == 'storage' else 'secret')
        if 'add-iam-policy-binding' in args:
            role = next(a.split('=', 1)[1] for a in args if a.startswith('--role='))
            member = next(a.split('=', 1)[1] for a in args if a.startswith('--member='))
            self.grants[kind].append({'role': role, 'members': [member]})
        if 'get-iam-policy' in args:
            return {'bindings': self.grants[kind] + ([{'role': 'roles/storage.objectViewer', 'members': ['allUsers']}] if self.public else [])}
        return {}

class ProvisionTests(unittest.TestCase):
    def run_setup(self, c=None, directory=None):
        c = c or FakeCloud()
        if directory is None:
            directory = Path(self.tmp.name) / 'new'
        with contextlib.redirect_stdout(self.output):
            return c, directory, P.provision(c, directory, approved=True)
    def setUp(self):
        self.tmp, self.output = tempfile.TemporaryDirectory(), io.StringIO()
    def tearDown(self):
        self.tmp.cleanup()
    def test_new_project_complete_and_key_stays_in_memory(self):
        c, directory, result = self.run_setup()
        self.assertTrue(result['verified'])
        self.assertEqual(result['geminiRequestsSent'], 0)
        config = json.loads((directory / 'config.json').read_text())
        self.assertEqual(config['keyResource'], KR)
        self.assertTrue(config['provenanceConfirmed'])
        self.assertNotIn(PRIVATE, self.output.getvalue())
        for file in directory.iterdir():
            self.assertNotIn(PRIVATE, file.read_text())
            self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        secret_reads = [args for args, _ in c.calls if 'get-key-string' in args]
        self.assertEqual(secret_reads, [['services', 'api-keys', 'get-key-string', KR]])
        writes = [data for _, data in c.calls if data]
        self.assertEqual(writes, [PRIVATE])
        self.assertTrue(json.loads((directory / 'setup-journal.json').read_text())['complete'])
    def test_scope_no_old_project_no_role_expansion_no_gemini(self):
        c, _, _ = self.run_setup()
        args = json.dumps([a for a, _ in c.calls])
        for forbidden in ['yoshi-lab-db3eb', 'test01', 'test02', 'test03', 'roles/editor', 'roles/owner', 'generateContent', 'get-model', 'org-policies', 'service-accounts keys']:
            self.assertNotIn(forbidden, args)
        self.assertFalse(any(a[:2] == ['projects', 'create'] or a[:3] == ['billing', 'projects', 'link'] for a, _ in c.calls))
        self.assertEqual(len(c.grants['project']), 1)
        self.assertFalse(any('serviceAccount:' + EMAIL in b['members'] for bs in c.grants.values() for b in bs))
    def test_invalid_old_and_overlong_ids_fail_before_cloud(self):
        for v in ['yoshi-lab-db3eb', 'yoshilab-material-test03', 'yoshilab-material-ai-1234567890', 'PRIVATE-KEY']:
            with self.assertRaises(P.Stop):
                P.Cloud(v)
    def test_missing_approval_has_no_calls_or_files(self):
        c = FakeCloud()
        with self.assertRaises(P.Stop):
            P.provision(c, Path(self.tmp.name) / 'new')
        self.assertEqual(c.calls, [])
        self.assertFalse((Path(self.tmp.name) / 'new').exists())
    def test_existing_resources_stop_before_any_key_secret_or_iam_change(self):
        c = FakeCloud(existing=True)
        with self.assertRaises(P.Stop):
            self.run_setup(c)
        self.assertFalse(c.created)
        self.assertFalse(any('create' in a or 'add-iam-policy-binding' in a for a, _ in c.calls))
    def test_inventory_failure_is_not_absence(self):
        c = FakeCloud(fail=lambda a: a[:3] == ['services', 'api-keys', 'list'])
        with self.assertRaises(P.Stop):
            self.run_setup(c)
        self.assertFalse(c.created)
    def test_existing_sa_stops(self):
        c = FakeCloud()
        c.sa_exists = True
        with self.assertRaises(P.Stop):
            self.run_setup(c)
        self.assertFalse(c.created)
    def test_no_billing_or_stale_project_stops_before_enable(self):
        for option in ['billing', 'age']:
            c = FakeCloud()
            setattr(c, option, False if option == 'billing' else 8)
            with self.assertRaises(P.Stop):
                self.run_setup(c, Path(self.tmp.name) / option)
            self.assertFalse(any(a[:2] == ['services', 'enable'] for a, _ in c.calls))
    def test_duplicate_run_does_not_recreate_or_read_key(self):
        c, directory, _ = self.run_setup()
        calls = len(c.calls)
        with self.assertRaises(FileExistsError):
            self.run_setup(c, directory)
        self.assertEqual(len(c.calls), calls)
    def test_key_creation_failure_never_reads_key_or_creates_secret(self):
        c = FakeCloud(fail=lambda a: a[:3] == ['services', 'api-keys', 'create'])
        with self.assertRaises(P.Stop):
            self.run_setup(c)
        self.assertFalse(any('get-key-string' in a or a[:2] == ['secrets', 'create'] for a, _ in c.calls))
        journal = json.loads((Path(self.tmp.name) / 'new/setup-journal.json').read_text())
        self.assertFalse(journal['complete'])
        self.assertEqual(journal['step'], 'create-auth-key')
    def test_cross_shell_bucket_collision_stops_before_sa_or_key(self):
        c = FakeCloud(fail=lambda a: a[:3] == ['storage', 'buckets', 'create'])
        with self.assertRaises(P.Stop):
            self.run_setup(c)
        self.assertFalse(any(a[:3] in (['iam', 'service-accounts', 'create'], ['services', 'api-keys', 'create']) for a, _ in c.calls))
    def test_secret_registration_failure_is_not_retried_or_followed_by_iam(self):
        c = FakeCloud(fail=lambda a: a[:3] == ['secrets', 'versions', 'add'])
        with self.assertRaises(P.Stop):
            self.run_setup(c)
        self.assertEqual(sum(a[:3] == ['secrets', 'versions', 'add'] for a, _ in c.calls), 1)
        self.assertFalse(any('add-iam-policy-binding' in a for a, _ in c.calls))
        self.assertNotIn(PRIVATE, self.output.getvalue())
    def test_shell_approval_stops_before_node_or_gcloud(self):
        shell = str(Path(P.__file__).with_name('cloud-shell.sh'))
        env = dict(os.environ)
        env.pop('MG_SETUP_APPROVED', None)
        env.pop('MG_ISOLATED_APPROVED', None)
        for stage in ['setup', 'verify-model', 'generate-ten']:
            p = subprocess.run(['bash', shell, stage, PID], capture_output=True, text=True, env=env)
            self.assertNotEqual(p.returncode, 0)
            self.assertIn('APPROVAL_REQUIRED', p.stderr)
            self.assertNotIn(PRIVATE, p.stdout + p.stderr)
    def test_wrong_key_never_accesses_string(self):
        c = FakeCloud()
        c.key_mismatch = True
        with self.assertRaises(P.Stop):
            self.run_setup(c)
        self.assertFalse(any('get-key-string' in a for a, _ in c.calls))
    def test_public_bucket_or_wrong_owner_prevents_config(self):
        for option in ['public', 'bucket_mismatch']:
            c = FakeCloud()
            setattr(c, option, True)
            directory = Path(self.tmp.name) / option
            with self.assertRaises(P.Stop):
                self.run_setup(c, directory)
            self.assertFalse((directory / 'config.json').exists())
    def test_check_only_reads_metadata_no_secret_or_mutation(self):
        c, directory, _ = self.run_setup()
        c.calls.clear()
        config = json.loads((directory / 'config.json').read_text())
        result = P.verify(c, config, MEMBER)
        self.assertTrue(result['verified'])
        self.assertFalse(any(any(word in a for word in ['create', 'enable', 'get-key-string', 'access', 'cp', 'add-iam-policy-binding', 'add']) for a, _ in c.calls))
    def test_subprocess_capture_and_errors_do_not_disclose(self):
        def fake(args, **kw):
            self.assertEqual(kw['env']['CLOUDSDK_CORE_LOG_HTTP'], 'false')
            self.assertEqual(kw['env']['CLOUDSDK_STORAGE_MAX_RETRIES'], '0')
            self.assertTrue(kw['capture_output'])
            self.assertIn('--project=' + PID, args)
            self.assertNotIn(PRIVATE, args)
            return subprocess.CompletedProcess(args, 1, PRIVATE, PRIVATE)
        with patch.object(P.subprocess, 'run', side_effect=fake):
            with self.assertRaises(P.Stop) as error:
                P.Cloud(PID).call(['secrets', 'versions', 'add', 'material-ai-gemini'], data=PRIVATE)
        self.assertNotIn(PRIVATE, str(error.exception))
    def test_default_plan_is_offline_and_cli_errors_hide_arguments(self):
        p = subprocess.run([sys.executable, '-B', str(Path(P.__file__))], capture_output=True, text=True)
        self.assertEqual(json.loads(p.stdout)['geminiRequestsSent'], 0)
        p = subprocess.run([sys.executable, '-B', str(Path(P.__file__)), 'setup', PRIVATE], capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0)
        self.assertNotIn(PRIVATE, p.stdout + p.stderr)

if __name__ == '__main__':
    import sys
    unittest.main()
