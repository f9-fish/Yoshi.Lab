import importlib.util
import json
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / 'scripts/studio-gemini-header-diagnosis.py'
spec = importlib.util.spec_from_file_location('diagnosis', path)
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


class DiagnosisTest(unittest.TestCase):
    def test_headers_deadline_and_504_are_projected_without_payload_or_request_metadata(self):
        base = {'timestamp': '2026-11-26T03:29:22Z',
                'resource': {'labels': {'revision_name': 'studioapi-mock'}}, 'trace': 'private-trace'}
        rows = [
            {**base, 'textPayload': json.dumps({'event': 'studio_gemini_generation', 'stage': 'headers',
                'elapsedMs': 55004, 'outcome': 'deadline', 'prompt': 'private-text', 'profile': 'private-label'})},
            {**base, 'logName': 'projects/mock/logs/run.googleapis.com%2Frequests', 'httpRequest': {
                'status': 504, 'requestMethod': 'POST', 'latency': '56.381813692s', 'requestUrl': 'private-url'}},
        ]
        result = d.diagnostics(rows)
        self.assertEqual(result['generation'][0]['stage'], 'headers')
        self.assertNotIn('upstreamStatus', result['generation'][0])
        self.assertEqual(result['http504'][0]['latency'], '56.381813692s')
        self.assertNotIn('private-', json.dumps(result))

    def test_revision_network_check_only_emits_flags(self):
        revision = {'spec': {'containers': [{'env': [
            {'name': 'STUDIO_GEMINI_MODEL', 'value': 'gemini-3.8-flash'},
            {'name': 'STUDIO_GEMINI_API_KEY', 'valueFrom': {'secretKeyRef': {'name': 'private-name', 'key': '4'}}},
            {'name': 'HTTPS_PROXY', 'value': 'private-proxy'},
        ]}]}, 'metadata': {'annotations': {'run.googleapis.com/vpc-access-connector': 'private-connector',
                                          'run.googleapis.com/vpc-access-egress': 'all-traffic'}}}
        result = d.settings(revision)
        self.assertEqual(result, {'modelMatches': True, 'secretReferencePresent': True, 'vpcConfigured': True,
                                  'vpcEgress': 'all-traffic', 'proxyVariablesPresent': True})


if __name__ == '__main__':
    unittest.main()
