import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

path = Path(__file__).resolve().parents[1] / 'scripts' / 'studio-master-production-switch.py'
spec = importlib.util.spec_from_file_location('production_switch', path)
switch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(switch)

SHEET = 'sample-production-sheet-123456789'
ENV = {switch.ACTIVE: switch.TEST_SHEET, switch.READER: switch.runtime.SETTINGS[switch.READER],
       'STUDIO_GEMINI_MODEL': 'gemini-3.8-flash', 'STUDIO_ALLOWED_ORIGINS': 'allowed'}


def state(env):
    return {'function': {'environmentVariables': dict(env), 'serviceAccountEmail': switch.runtime.RUNTIME},
            'runRevision': {'serviceAccount': switch.runtime.RUNTIME, 'containers': [
                {'env': [{'name': key, 'value': value} for key, value in env.items()]}]}}


class ProductionSwitch(unittest.TestCase):
    def test_stage_preserves_active_and_switch_changes_only_two_keys(self):
        before = state(ENV)
        staged = switch.plan_environment(before, 'stage', SHEET)
        self.assertEqual(staged, {**ENV, switch.CANDIDATE: SHEET})
        after_stage = state(staged)
        final = switch.plan_environment(after_stage, 'switch', SHEET)
        self.assertEqual(final, {**ENV, switch.ACTIVE: SHEET})
        after = state(final)
        switch.configuration(after, SHEET, None)
        self.assertEqual(before, after_stage)
        self.assertEqual(before, after)

    def test_mismatched_candidate_or_revision_config_stops(self):
        current = state({**ENV, switch.CANDIDATE: SHEET})
        with self.assertRaises(switch.studio.Stop):
            switch.plan_environment(current, 'switch', 'some-other-target')
        current['runRevision']['containers'][0]['env'].pop()
        with self.assertRaises(switch.studio.Stop):
            switch.plan_environment(current, 'switch', SHEET)
        with self.assertRaises(switch.studio.Stop):
            switch.plan_environment(state(ENV), 'switch', SHEET)

    def test_switch_update_touches_only_existing_function_environment(self):
        client = Mock()
        client.json.side_effect = [{'name': switch.studio.PARENT + '/operations/mock'}, {'done': True}]
        switch.studio.submit(client, None, environment=ENV)
        self.assertEqual(client.json.call_args_list[0].args,
                         (switch.studio.GCF + switch.studio.FUNCTION + '?updateMask=serviceConfig.environmentVariables',
                          'PATCH', {'serviceConfig': {'environmentVariables': ENV}}))
        self.assertEqual(client.json.call_count, 2)
        client.request.assert_not_called()


if __name__ == '__main__':
    unittest.main()
