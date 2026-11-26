import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import Mock
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


if __name__ == '__main__':
    unittest.main()
