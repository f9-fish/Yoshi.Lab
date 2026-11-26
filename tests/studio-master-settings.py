"""Offline checks for the read-only deployment comparison."""
import importlib.util
from copy import deepcopy
from pathlib import Path
from unittest import TestCase, main

path = Path(__file__).resolve().parents[1] / 'scripts/studio-master-settings.py'
spec = importlib.util.spec_from_file_location('settings', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Comparison(TestCase):
    def setUp(self):
        self.one = {
            'function': {'environmentVariables': {'STUDIO_GEMINI_MODEL': 'unchanged'}},
            'runRevision': {'containers': [{'env': [{'name': 'STUDIO_GEMINI_MODEL', 'value': 'unchanged'}]}]},
            'functionIam': {'bindings': []}, 'runIam': {'bindings': []}, 'runService': {'traffic': []},
        }
        self.before = {'function': module.studio.FUNCTION, 'revision': 'old',
                       'sections': module.section_hashes(self.one)}
        self.values = dict(zip(module.ADDITIONS, ['candidate-sheet', 'candidate-reader']))

    def test_additions_only_and_other_settings_change(self):
        after = deepcopy(self.one)
        after['function']['environmentVariables'].update(self.values)
        after['runRevision']['containers'][0]['env'] += [{'name': k, 'value': v} for k, v in self.values.items()]
        self.assertEqual(module.verify(self.before, after, 'new', self.values), [])
        after['runIam']['bindings'].append('extra')
        self.assertEqual(module.verify(self.before, after, 'new', self.values), ['runIam'])

    def test_missing_values_or_old_revision_are_rejected(self):
        with self.assertRaises(module.studio.Stop):
            module.verify(self.before, self.one, 'new', self.values)
        with self.assertRaises(module.studio.Stop):
            module.verify(self.before, self.one, 'old', self.values)


if __name__ == '__main__':
    main()
