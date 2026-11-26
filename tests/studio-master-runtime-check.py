import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch
import zipfile

path = Path(__file__).resolve().parents[1] / 'scripts' / 'studio-master-runtime-check.py'
spec = importlib.util.spec_from_file_location('master_rollout', path)
master = importlib.util.module_from_spec(spec)
spec.loader.exec_module(master)


def archive(files):
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w') as zipped:
        for name, data in files.items():
            zipped.writestr(name, data)
    return result.getvalue()


class RuntimeRollout(unittest.TestCase):
    def test_pr96_pr99_and_pr100_source_baselines(self):
        baselines = {
            'pr96': {name: b'old' for name in master.studio.SOURCE_FILES},
            'pr99': {name: b'old' for name in master.FILES},
            'pr100': {name: b'new' if name == master.MODULE else b'old' for name in master.FILES},
        }
        target = {**baselines['pr100'], 'index.js': b'diagnostic'}
        for expected, files in baselines.items():
            live = archive({**files, 'retained.txt': b'untouched'})
            label, changed, planned = master.plan_source(live, baselines, target)
            self.assertEqual(label, expected)
            self.assertEqual(changed, ['index.js'] if label == 'pr100' else ['index.js', master.MODULE])
            self.assertEqual(master.zip_contents(planned), {**target, 'retained.txt': b'untouched'})
            self.assertEqual(planned, master.plan_source(live, baselines, target)[2])
        with self.assertRaises(master.studio.Stop):
            master.plan_source(archive({**files, 'index.js': b'unrecognized'}), baselines, target)
        with self.assertRaises(master.studio.Stop):
            master.plan_source(archive(files), baselines, {**target, 'package-lock.json': b'changed'})

    def test_settings_keep_existing_entries_and_stop_on_wrong_values(self):
        plain = {'STUDIO_GEMINI_MODEL': 'gemini-3.8-flash', 'STUDIO_ALLOWED_ORIGINS': 'allowed'}
        secret = {'name': 'SECRET', 'valueSource': {'secretKeyRef': {'secret': 'reference'}}}

        def state(values, identity=master.RUNTIME):
            return {'function': {'environmentVariables': dict(values), 'serviceAccountEmail': identity},
                    'runRevision': {'serviceAccount': identity, 'containers': [
                        {'env': [secret, *({'name': key, 'value': value} for key, value in values.items())]}]}}

        before = state(plain)
        additions = master.configure(before)
        self.assertEqual(additions, {**plain, **master.SETTINGS})
        after = state(additions)
        master.configure(after, after=True)
        self.assertEqual(before, after)
        with self.assertRaises(master.studio.Stop):
            master.configure(state(additions))
        with self.assertRaises(master.studio.Stop):
            master.configure(state(plain, 'wrong'))
        with self.assertRaises(master.studio.Stop):
            master.configure(state({**additions, 'STUDIO_MASTER_SPREADSHEET_ID': 'wrong'}), after=True)

    def test_update_targets_existing_function_and_only_source_and_env(self):
        with patch.object(master.studio, 'Client') as factory:
            client = factory.return_value
            client.json.side_effect = [
                {'uploadUrl': 'https://storage.googleapis.com/signed', 'storageSource': {'bucket': 'staging'}},
                {'name': master.studio.PARENT + '/operations/mock'}, {'done': True},
            ]
            master.studio.submit(client, b'archive', environment={'old': 'keep', **master.SETTINGS})
            url, method, payload = client.json.call_args_list[1].args
            self.assertEqual(url, master.studio.GCF + master.studio.FUNCTION +
                             '?updateMask=buildConfig.source,serviceConfig.environmentVariables')
            self.assertEqual(method, 'PATCH')
            self.assertEqual(payload, {'buildConfig': {'source': {'storageSource': {'bucket': 'staging'}}},
                                       'serviceConfig': {'environmentVariables': {'old': 'keep', **master.SETTINGS}}})


if __name__ == '__main__':
    unittest.main()
