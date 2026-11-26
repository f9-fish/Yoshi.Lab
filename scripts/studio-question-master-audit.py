#!/usr/bin/env python3
"""Read-only source and configuration comparison for the Issue #102 release."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('studio_runtime', Path(__file__).with_name('studio-master-runtime-check.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
studio = runtime.studio
BASELINE = '25fb3570d1b2d92b0f82a296bac9a340cd8fe3d4'
NEW_FILE = 'question-master.cjs'
KEYS = ('STUDIO_QUESTION_MASTER_SPREADSHEET_ID', 'STUDIO_QUESTION_MASTER_WRITER_SERVICE_ACCOUNT')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def audit(state, archive, expected_env):
    info = studio.matching_runtime(state)
    projection = studio.config_projection(state)
    env = projection['function'].get('environmentVariables', {})
    container = projection['runRevision']['containers'][0]
    deployed = {entry['name']: entry for entry in container['env']}
    for key, expected in zip(KEYS, expected_env):
        entry = {'name': key, 'value': expected} if expected else None
        if env.get(key) != expected or deployed.get(key) != entry:
            raise studio.Stop('Issue #102 の環境変数が予定した状態と一致しません')
        env.pop(key, None)
    container['env'] = [entry for entry in container['env'] if entry['name'] not in KEYS]
    files = runtime.zip_contents(archive)
    base = runtime.source_at(BASELINE)
    target = runtime.source_at('HEAD', (*runtime.FILES, NEW_FILE))
    if any(base[name] != target[name] for name in base if name != 'index.js'):
        raise studio.Stop('共通ファイルに別の変更があります')
    expected_source = target if all(expected_env) else base
    if any(files.get(name) != expected_source.get(name) for name in target):
        raise studio.Stop('稼働ソースが想定した実行ファイルと一致しません')
    other = {name: hashlib.sha256(data).hexdigest() for name, data in files.items() if name not in target}
    return {'revision': info['revision'], 'configuration': digest(projection), 'otherFiles': digest(other)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', type=Path, required=True)
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--sheet-id')
    parser.add_argument('--writer')
    args = parser.parse_args()
    if args.verify != bool(args.sheet_id and args.writer) or (not args.verify and (args.sheet_id or args.writer)):
        raise studio.Stop('更新後の確認には --verify --sheet-id --writer を指定してください')
    client = studio.Client()
    state = studio.snapshot(client)
    receipt = audit(state, studio.source_archive(client, state[0]), (args.sheet_id, args.writer))
    if not args.verify:
        with args.before.open('x') as file:
            json.dump(receipt, file)
    else:
        prior = json.loads(args.before.read_text())
        if prior['revision'] == receipt['revision'] or any(prior[key] != receipt[key] for key in ('configuration', 'otherFiles')):
            raise studio.Stop('新リビジョン、既存設定または既存アーカイブに予定外の差分があります')
    print(json.dumps({'revision': receipt['revision'], 'verifiedAfterUpdate': args.verify}))


if __name__ == '__main__':
    try:
        main()
    except (studio.Stop, OSError, ValueError, KeyError, TypeError, studio.zipfile.BadZipFile) as error:
        print(str(error) if isinstance(error, studio.Stop) else '実行構成またはソースの照合に失敗しました')
        raise SystemExit(1)
