#!/usr/bin/env python3
"""Before/after comparison for the existing studioApi. Only reads Cloud APIs."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re

from copy import deepcopy

module_path = Path(__file__).with_name('studio-pr96-deployment.py')
spec = importlib.util.spec_from_file_location('studio_deployment', module_path)
studio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(studio)

ADDITIONS = ('STUDIO_MASTER_SPREADSHEET_ID', 'STUDIO_MASTER_READER_SERVICE_ACCOUNT')


def settings_only(projection):
    projection = deepcopy(projection)
    env = projection['function'].get('environmentVariables', {})
    for name in ADDITIONS:
        env.pop(name, None)
    for container in projection['runRevision']['containers']:
        container['env'] = [entry for entry in container['env'] if entry['name'] not in ADDITIONS]
    return projection


def section_hashes(projection):
    return {key: hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            for key, value in settings_only(projection).items()}


def verify(before, projection, revision, expected):
    if before.get('function') != studio.FUNCTION or before.get('revision') == revision:
        raise studio.Stop('確認対象の関数または新リビジョンが一致しません')
    function_env = projection['function'].get('environmentVariables', {})
    runtime_env = {entry['name']: entry for entry in projection['runRevision']['containers'][0]['env']}
    if any(function_env.get(key) != value or runtime_env.get(key, {}).get('value') != value for key, value in expected.items()):
        raise studio.Stop('環境変数2件が承認した値と一致しません')
    current = section_hashes(projection)
    if not isinstance(before.get('sections'), dict) or set(before['sections']) != set(current):
        raise studio.Stop('事前確認ファイルの形式が不正です')
    return sorted(key for key, val in current.items() if before['sections'][key] != val)


def main():
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--record', type=Path)
    modes.add_argument('--verify', type=Path)
    parser.add_argument('--reader')
    parser.add_argument('--sheet-id')
    args = parser.parse_args()
    if args.verify and (not re.fullmatch(r'[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com', args.reader or '') or
                        not re.fullmatch(r'[A-Za-z0-9_-]{20,100}', args.sheet_id or '')):
        raise studio.Stop('確認対象の閲覧用アカウントとシートIDを指定してください')
    state = studio.snapshot(studio.Client())
    info = studio.matching_runtime(state)
    projection = studio.config_projection(state)
    if args.record:
        function_env = projection['function'].get('environmentVariables', {})
        run_env = {entry['name'] for container in projection['runRevision']['containers'] for entry in container['env']}
        if any(key in function_env or key in run_env for key in ADDITIONS):
            raise studio.Stop('対象の環境変数が既にあります。追加として進めず現在値を確認してください')
        receipt = {'function': studio.FUNCTION, 'revision': info['revision'], 'sections': section_hashes(projection)}
        with args.record.open('x') as file:
            json.dump(receipt, file)
        print(json.dumps({'stage': 'recorded', 'revision': info['revision']}))
    else:
        expected = dict(zip(ADDITIONS, (args.sheet_id, args.reader)))
        differences = verify(json.loads(args.verify.read_text()), projection, info['revision'], expected)
        print(json.dumps({'stage': 'verified' if not differences else 'different', 'revision': info['revision'],
                          'configurationDiffSections': differences}))
        if differences:
            raise studio.Stop('予定外の設定差分があります。次の操作を停止してください')


if __name__ == '__main__':
    import os
    os.umask(0o077)
    try:
        main()
    except (studio.Stop, OSError, ValueError, KeyError, TypeError) as error:
        print(str(error) if isinstance(error, studio.Stop) else '設定の読み取り・照合に失敗しました')
        raise SystemExit(1)
