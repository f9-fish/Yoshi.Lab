import hashlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import zipfile

spec = importlib.util.spec_from_file_location('preflight',
    Path(__file__).resolve().parents[1] / 'scripts' / 'studio-publication-runtime-preflight.py')
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


def zip_bytes(files):
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w') as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return result.getvalue()


class PublicationPreflight(unittest.TestCase):
    def setUp(self):
        self.before = {name: b'old' for name in preflight.question.FILES}
        self.after = {**self.before, 'index.js':b'with #108'}
        self.archive = zip_bytes({**self.before, 'untouched':b'archive member'})

    def test_only_index_is_patched_and_repeated_check_is_noop(self):
        baseline, files, planned = preflight.plan_update(self.archive,self.before,self.after)
        self.assertEqual((baseline,files),('pre-pr108',['index.js']))
        self.assertEqual(preflight.runtime.zip_contents(planned),{**self.after,'untouched':b'archive member'})
        self.assertEqual(preflight.plan_update(planned,self.before,self.after),('pr108',[],planned))
        with self.assertRaises(preflight.studio.Stop):
            preflight.plan_update(self.archive,self.before,{**self.after,'package.json':b'new'})
        with self.assertRaises(preflight.studio.Stop):
            preflight.plan_update(zip_bytes({**self.before,'index.js':b'unknown'}),self.before,self.after)

    def test_rollback_restores_original_bytes_and_rejects_drift(self):
        _,_,planned = preflight.plan_update(self.archive,self.before,self.after)
        configuration = {'connections':'unchanged'}
        storage = {'bucket':'source','object':'source.zip','generation':'123'}
        receipt = {'source':storage,'archiveSha256':hashlib.sha256(self.archive).hexdigest(),
                   'installedHash':preflight.question.content_hash(planned),
                   'configurationHash':preflight.question.audit.digest(configuration)}
        client = Mock()
        with patch.object(preflight.studio,'source_archive',return_value=self.archive):
            self.assertEqual(preflight.restore_plan(client,receipt,planned,configuration,self.before,self.after),
                             self.archive)
            with self.assertRaises(preflight.studio.Stop):
                preflight.restore_plan(client,receipt,planned,{},self.before,self.after)
            with self.assertRaises(preflight.studio.Stop):
                preflight.restore_plan(client,receipt,self.archive,configuration,self.before,self.after)
        with patch.object(preflight.studio,'source_archive',return_value=planned):
            with self.assertRaises(preflight.studio.Stop):
                preflight.restore_plan(client,receipt,planned,configuration,self.before,self.after)

    def test_source_only_update_has_no_environment_update_mask(self):
        client=Mock()
        client.json.side_effect=[
            {'uploadUrl':'https://storage.googleapis.com/signed','storageSource':{'bucket':'mock'}},
            {'name':preflight.studio.PARENT+'/operations/mock'},
            {'done':True},
        ]
        preflight.studio.submit(client,self.archive)
        self.assertEqual(client.json.call_args_list[1].args,(
            preflight.studio.GCF+preflight.studio.FUNCTION+'?updateMask=buildConfig.source','PATCH',
            {'buildConfig':{'source':{'storageSource':{'bucket':'mock'}}}}))


if __name__ == '__main__':
    unittest.main()
