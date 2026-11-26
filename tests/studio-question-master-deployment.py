import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import zipfile

spec = importlib.util.spec_from_file_location('question_deploy',
    Path(__file__).resolve().parents[1] / 'scripts' / 'studio-question-master-deployment.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class Deployment(unittest.TestCase):
    def test_archive_strict_match_and_preservation(self):
        base = {n: b'old' for n in deploy.FILES if n != deploy.audit.NEW_FILE}
        target = {**base, 'index.js': b'new', deploy.audit.NEW_FILE: b'new'}
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as archive:
            for name, data in {**base, 'retain': b'unrelated'}.items():
                archive.writestr(name, data)
        original = buf.getvalue()
        plan = deploy.source_plan(original, {'baseline': base}, target)
        self.assertEqual(plan[:2], ('baseline', ['index.js', deploy.audit.NEW_FILE]))
        self.assertEqual(deploy.runtime.zip_contents(plan[2]), {**target, 'retain': b'unrelated'})
        self.assertEqual(plan, deploy.source_plan(original, {'baseline': base}, target))
        with self.assertRaises(deploy.studio.Stop):
            deploy.source_plan(original, {'baseline': target}, target)
        with self.assertRaises(deploy.studio.Stop):
            deploy.source_plan(original, {'baseline': base}, {**target, 'package.json': b'bad'})

    def test_configuration_keeps_existing_settings_and_rejects_conflicts(self):
        account = deploy.runtime.RUNTIME
        env = {'STUDIO_GEMINI_MODEL': 'model', 'STUDIO_ALLOWED_ORIGINS': 'origin'}
        view = {'function': {'environmentVariables': dict(env), 'serviceAccountEmail': account},
                'runRevision': {'serviceAccount': account, 'containers': [{'env': [
                    {'name': k, 'value': v} for k, v in env.items()]}]}}
        self.assertEqual(deploy.settings(view, {}), env)
        with self.assertRaises(deploy.studio.Stop):
            deploy.settings(view, {deploy.PILOT: 'teacher'})
        live_env = {**env, deploy.PILOT: 'teacher'}
        view['function']['environmentVariables'] = live_env
        view['runRevision']['containers'][0]['env'].append({'name': deploy.PILOT, 'value': 'teacher'})
        self.assertEqual(deploy.settings(view, {deploy.PILOT: 'teacher'}), env)
        self.assertEqual(live_env[deploy.PILOT], 'teacher')
        for sheet in deploy.PROTECTED_SHEETS:
            with self.assertRaises(deploy.studio.Stop):
                deploy.desired(env, sheet, 'writer', None)
        with self.assertRaises(deploy.studio.Stop):
            deploy.desired(env, 'sheet', deploy.runtime.SETTINGS['STUDIO_MASTER_READER_SERVICE_ACCOUNT'], None)

    def test_environment_only_update_never_uploads_source(self):
        client = Mock()
        client.json.side_effect = [{'name': deploy.studio.PARENT + '/operations/mock'}, {'done': True}]
        deploy.studio.submit(client, None, environment={'old': 'keep'})
        self.assertEqual(client.json.call_args_list[0].args, (
            deploy.studio.GCF + deploy.studio.FUNCTION + '?updateMask=serviceConfig.environmentVariables',
            'PATCH', {'serviceConfig': {'environmentVariables': {'old': 'keep'}}}))
        client.request.assert_not_called()

    def test_binding_is_scoped_and_deny_overrides_direct_grant(self):
        client = Mock()
        member = 'serviceAccount:' + deploy.runtime.RUNTIME
        client.json.side_effect = [
            {'bindings': [{'role': deploy.TOKEN_ROLE, 'members': [member]}]},
            {'overallAccessState': 'CANNOT_ACCESS'},
        ]
        result = deploy.writer_access(client, deploy.CONFIRMED_WRITER)
        self.assertEqual(result['effectiveGetAccessToken'], 'denied')
        self.assertTrue(result['directTokenCreator'])
        url, method, request = client.json.call_args_list[1].args
        self.assertTrue(url.endswith('/v3/iam:troubleshoot'))
        self.assertEqual(method, 'POST')
        self.assertEqual(request['accessTuple'], {
            'principal': deploy.runtime.RUNTIME,
            'permission': 'iam.serviceAccounts.getAccessToken',
            'fullResourceName': '//iam.googleapis.com/projects/yoshi-lab-db3eb/serviceAccounts/' + deploy.CONFIRMED_WRITER,
        })

    def test_custom_or_inherited_grant_and_unavailable_policy(self):
        client = Mock()
        client.json.side_effect = [
            {'bindings': [{'role': deploy.TOKEN_ROLE, 'members': ['serviceAccount:'+deploy.runtime.RUNTIME],
                           'condition': {'expression': 'false'}}]},
            {'overallAccessState': 'CAN_ACCESS'},
        ]
        self.assertEqual(deploy.writer_access(client, deploy.CONFIRMED_WRITER),
                         {'directTokenCreator': False, 'directRoleCount': 0, 'directExactCustomRole': False,
                          'policyState': 'CAN_ACCESS', 'effectiveGetAccessToken': 'granted'})
        client.json.side_effect = deploy.studio.Stop('unavailable')
        self.assertIsNone(deploy.writer_access(client, deploy.CONFIRMED_WRITER)['directTokenCreator'])

    def test_connect_never_applies_without_effective_access(self):
        args = ['deploy', 'connect', '--sheet-id', 'independent-sheet-example-123', '--apply-approved', 'a'*64]
        baseline = {name: b'source' for name in deploy.FILES}
        with patch('sys.argv', args), patch.object(deploy.studio, 'Client'), \
             patch.object(deploy.studio, 'command'), patch.object(deploy.runtime, 'source_at', return_value=baseline), \
             patch.object(deploy.studio, 'snapshot', return_value=({},)), \
             patch.object(deploy.studio, 'matching_runtime', return_value={'revision': 'mock'}), \
             patch.object(deploy.studio, 'source_archive', return_value=b'zip'), \
             patch.object(deploy, 'source_plan', return_value=('target', [], b'zip')), \
             patch.object(deploy.studio, 'config_projection'), patch.object(deploy, 'settings', return_value={}), \
             patch.object(deploy.studio, 'submit') as submit, \
             patch.object(deploy, 'writer_access', return_value={'effectiveGetAccessToken': 'unverified'}):
            with self.assertRaisesRegex(deploy.studio.Stop, '実効権限'):
                deploy.main()
            submit.assert_not_called()

    def test_exact_direct_role_permits_explicit_unknown_connection_only(self):
        client = Mock()
        client.json.side_effect = [
            {'bindings': [{'role': deploy.CUSTOM_ROLE, 'members': ['serviceAccount:'+deploy.runtime.RUNTIME]}]},
            {'includedPermissions': [deploy.TOKEN_PERMISSION], 'stage': 'GA'},
            {'overallAccessState': 'UNKNOWN_INFO'},
        ]
        access = deploy.writer_access(client, deploy.CONFIRMED_WRITER)
        self.assertTrue(access['directExactCustomRole'])
        with self.assertRaises(deploy.studio.Stop):
            deploy.allow_apply('connect', access, False, False)
        deploy.allow_apply('connect', access, True, False)
        with self.assertRaises(deploy.studio.Stop):
            deploy.allow_apply('activate', access, True, False)
        deploy.allow_apply('activate', access, True, True)
        with self.assertRaises(deploy.studio.Stop):
            deploy.allow_apply('connect', {**access, 'effectiveGetAccessToken': 'denied'}, True, False)
        with self.assertRaises(deploy.studio.Stop):
            deploy.allow_apply('connect', {**access, 'policyState': None}, True, False)

    def test_rollback_validates_storage_generation_and_refuses_drift(self):
        base = {name: b'base' for name in deploy.FILES}
        result = io.BytesIO()
        with zipfile.ZipFile(result,'w') as archive:
            for name,data in base.items():
                archive.writestr(name,data)
        prior = result.getvalue()
        source = {'bucket':'old','object':'function.zip','generation':'123'}
        function = {'buildConfig':{'sourceProvenance':{'resolvedStorageSource':source}}}
        projection = {'model':'old'}
        additions = {deploy.READ_ONLY:'true'}
        receipt = deploy.make_receipt(function,prior,prior,projection,additions)
        client = Mock()
        with patch.object(deploy.studio,'source_archive',return_value=prior) as get_archive:
            self.assertEqual(deploy.restore_source(client,receipt,projection,additions,{'base':base}),prior)
            get_archive.assert_called_once_with(client,function)
            with self.assertRaises(deploy.studio.Stop):
                deploy.restore_source(client,receipt,{'model':'changed'},additions,{'base':base})


if __name__ == '__main__':
    unittest.main()
