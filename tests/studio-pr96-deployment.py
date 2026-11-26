"""Offline tests for the source-only deployment preparation. No credentials or network."""
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch
import zipfile

path = Path(__file__).resolve().parents[1] / 'scripts/studio-pr96-deployment.py'
spec = importlib.util.spec_from_file_location('deployment', path)
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


class DeploymentTest(unittest.TestCase):
    def test_replaces_only_index_and_refuses_changed_baseline(self):
        original = {name: name.encode() for name in d.SOURCE_FILES}
        source = io.BytesIO()
        with zipfile.ZipFile(source, 'w') as archive:
            for name, content in original.items():
                archive.writestr(name, content)
            archive.writestr('tests/example', b'untouched')
        changed, baseline = d.replacement(source.getvalue(), original, b'new-index')
        self.assertEqual(baseline, 'pr96-base')
        with zipfile.ZipFile(io.BytesIO(changed)) as archive:
            self.assertEqual(archive.read('index.js'), b'new-index')
            self.assertEqual(archive.read('studio-core.cjs'), original['studio-core.cjs'])
            self.assertEqual(archive.read('tests/example'), b'untouched')
        with self.assertRaises(d.Stop):
            d.replacement(source.getvalue(), {**original, 'package-lock.json': b'wrong'}, b'new-index')

    def test_known_legacy_requires_exactly_the_three_confirmed_differences(self):
        comment = b"// Do not silently switch models when a future deployment loses its runtime setting.\n"
        explicit = b"const model=String(process.env.STUDIO_GEMINI_MODEL||'').trim();\n"
        fallback = b"const model=process.env.STUDIO_GEMINI_MODEL||'gemini-2.5-flash';\n"
        check = (
            "  if(action==='generate'&&!model)return json(res,503,"
            "{error:'AIモデルが未設定です。管理者にSTUDIO_GEMINI_MODELの確認を依頼してください'});\n"
        ).encode()
        base = b'// untouched\n' + comment + explicit + check + b'// untouched tail\n'
        expected = b'// untouched\n' + fallback + b'// untouched tail\n'
        other_files = {name: name.encode() for name in d.SOURCE_FILES if name != 'index.js'}
        before = {**other_files, 'index.js': base}
        desired = base + b'// PR 96\n'

        def archive(index):
            source = io.BytesIO()
            with zipfile.ZipFile(source, 'w') as bundle:
                for name, content in {**other_files, 'index.js': index}.items():
                    bundle.writestr(name, content)
            return source.getvalue()

        self.assertEqual(d.known_legacy_index(base), expected)
        data, baseline = d.replacement(archive(expected), before, desired)
        self.assertEqual(baseline, 'known-legacy-model-fallback')
        with zipfile.ZipFile(io.BytesIO(data)) as bundle:
            self.assertEqual(bundle.read('index.js'), desired)
            self.assertNotIn(b'gemini-2.5-flash', bundle.read('index.js'))
        for index in [expected + b'// extra\n', expected.replace(fallback, explicit),
                      expected.replace(fallback, fallback + check), expected.replace(fallback, comment + fallback),
                      expected.replace(b'// untouched\n', b'// untouched \n')]:
            with self.subTest(index=index), self.assertRaises(d.Stop):
                d.replacement(archive(index), before, desired)

    def test_apply_refuses_to_start_without_read_only_fingerprint(self):
        with patch('sys.argv', ['script', '--apply-approved']), patch.object(d, 'command') as command:
            with self.assertRaisesRegex(d.Stop, '先に読み取り専用で'):
                d.main()
            command.assert_not_called()

    def test_fingerprint_binds_configuration_archive_and_target(self):
        state = [{'env': ['private-value'], 'revision': 'current'}]
        actual = d.preflight_fingerprint(state, b'old-source', b'new-index')
        self.assertRegex(actual, r'^[a-f0-9]{64}$')
        self.assertEqual(actual, d.preflight_fingerprint([{'revision': 'current', 'env': ['private-value']}], b'old-source', b'new-index'))
        for params in [([{'revision': 'other'}], b'old-source', b'new-index'),
                       (state, b'other-archive', b'new-index'), (state, b'old-source', b'other-index')]:
            self.assertNotEqual(actual, d.preflight_fingerprint(*params))

    def test_live_settings_and_traffic(self):
        rev = d.SERVICE + '/revisions/' + d.EXPECTED_REV
        fn = {'name': d.FUNCTION, 'environment': 'GEN_2', 'state': 'ACTIVE',
              'buildConfig': {'entryPoint': 'studioApi', 'runtime': 'nodejs22'},
              'serviceConfig': {'service': d.SERVICE, 'timeoutSeconds': 90}}
        run = {'name': d.SERVICE, 'uri': d.HOST, 'latestCreatedRevision': rev,
               'trafficStatuses': [{'revision': rev, 'percent': 100}]}
        revision = {'name': rev, 'containers': [{'image': 'before', 'env': [
            {'name': 'STUDIO_GEMINI_MODEL', 'value': 'gemini-3.8-flash'},
            {'name': 'STUDIO_ALLOWED_ORIGINS', 'value': 'https://f9-fish.github.io'},
            {'name': 'PRIVATE', 'value': 'dummy-private'},
            *[{'name': name, 'valueSource': {'secretKeyRef': {'secret': 'dummy-name', 'version': 'latest'}}}
              for name in ('STUDIO_GEMINI_API_KEY', 'STUDIO_GITHUB_TOKEN')],
        ]}]}
        state = fn, run, revision, {}, {}
        self.assertEqual(d.matching_runtime(state, d.EXPECTED_REV)['timeoutSeconds'], 90)
        self.assertNotIn('dummy-', str(d.matching_runtime(state)))
        pinned = {**run, 'traffic': [{'type': 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', 'revision': rev, 'percent': 100}]}
        with self.assertRaises(d.Stop):
            d.matching_runtime((fn, pinned, revision, {}, {}))
        changed_image = {**revision, 'containers': [{**revision['containers'][0], 'image': 'after'}]}
        self.assertEqual(d.config_projection(state), d.config_projection((fn, run, changed_image, {}, {})))
        revision_env = changed_image['containers'][0]['env'] + [{'name': 'NEW', 'value': 'changed'}]
        changed_image['containers'][0]['env'] = revision_env
        self.assertNotEqual(d.config_projection(state), d.config_projection((fn, run, changed_image, {}, {})))

    def test_approved_update_targets_only_build_source(self):
        calls = []
        storage = {'bucket': 'fake-bucket', 'object': 'deployment.zip'}
        class FakeClient:
            def json(self, url, method='GET', body=None):
                calls.append((method, url, body))
                if method == 'POST':
                    return {'uploadUrl': 'https://storage.googleapis.com/fake-bucket/deployment.zip',
                            'storageSource': storage}
                if method == 'PATCH':
                    return {'name': d.PARENT + '/operations/test'}
                return {'done': True}
            def request(self, url, method, body, *, signed, extra_headers):
                calls.append((method, url, body))
                assert signed and extra_headers['Content-Type'] == 'application/zip'
        d.submit(FakeClient(), b'fixture')
        self.assertEqual([method for method, _, _ in calls], ['POST', 'PUT', 'PATCH', 'GET'])
        self.assertEqual(calls[2], (
            'PATCH', d.GCF + d.FUNCTION + '?updateMask=buildConfig.source',
            {'buildConfig': {'source': {'storageSource': storage}}},
        ))


if __name__ == '__main__':
    unittest.main()
