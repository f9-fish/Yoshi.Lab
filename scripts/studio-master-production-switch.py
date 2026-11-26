#!/usr/bin/env python3
"""Plan or apply a separately approved textbook master stage/switch."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import zipfile

spec = importlib.util.spec_from_file_location('runtime_check', Path(__file__).with_name('studio-master-runtime-check.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
studio = runtime.studio
BASE = '25fb3570d1b2d92b0f82a296bac9a340cd8fe3d4'
ACTIVE = 'STUDIO_MASTER_SPREADSHEET_ID'
CANDIDATE = 'STUDIO_MASTER_CANDIDATE_SPREADSHEET_ID'
READER = 'STUDIO_MASTER_READER_SERVICE_ACCOUNT'
TEST_SHEET = runtime.SETTINGS[ACTIVE]


def configuration(projection, active, candidate):
    function = projection['function']
    revision = projection['runRevision']
    if (function.get('serviceAccountEmail') != runtime.RUNTIME or
            revision.get('serviceAccount') != runtime.RUNTIME):
        raise studio.Stop('実行サービスアカウントが確認済みの構成と一致しません')
    env = function['environmentVariables']
    container = revision['containers'][0]
    deployed = {entry['name']: entry for entry in container['env']}
    expected = {ACTIVE: active, CANDIDATE: candidate, READER: runtime.SETTINGS[READER]}
    for name, value in expected.items():
        present = {'name': name, 'value': value} if value is not None else None
        if env.get(name) != value or deployed.get(name) != present:
            raise studio.Stop('関数とリビジョンの本文マスター設定が予定した状態と一致しません')
    saved = dict(env)
    for name in (ACTIVE, CANDIDATE):
        env.pop(name, None)
    container['env'] = [entry for entry in container['env'] if entry['name'] not in (ACTIVE, CANDIDATE)]
    return saved


def plan_environment(projection, phase, sheet_id):
    env = configuration(projection, TEST_SHEET, None if phase == 'stage' else sheet_id)
    if phase == 'stage':
        env[CANDIDATE] = sheet_id
    else:
        env[ACTIVE] = env.pop(CANDIDATE)
    return env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('stage', 'switch'))
    parser.add_argument('--sheet-id', required=True)
    parser.add_argument('--apply-approved', metavar='PREFLIGHT_SHA256')
    parser.add_argument('--candidate-verified', action='store_true', help='教員画面で対象選択の形式確認が成功した場合のみ')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_-]{20,100}', args.sheet_id) or args.sheet_id == TEST_SHEET:
        raise studio.Stop('テストシートと異なる候補シートIDを指定してください')
    if args.apply_approved is not None and not re.fullmatch(r'[a-f0-9]{64}', args.apply_approved):
        raise studio.Stop('照合値を確認してください')
    if args.apply_approved and args.phase == 'switch' and not args.candidate_verified:
        raise studio.Stop('先に教員画面で本番候補の形式確認を完了してください')

    studio.command('git', 'fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main')
    target, base = runtime.source_at('HEAD'), runtime.source_at(BASE)
    if runtime.source_at('origin/main') not in (base, target) or any(target[n] != base[n] for n in target if n != 'index.js'):
        raise studio.Stop('最新mainまたは関数ソースに未確認の差分があります')
    client = studio.Client()
    original = studio.snapshot(client)
    info = studio.matching_runtime(original)
    archive = studio.source_archive(client, original[0])
    expected_sources = {'verified-test-runtime': base} if args.phase == 'stage' else {'candidate-runtime': target}
    _, changes, planned = runtime.plan_source(archive, expected_sources, target)
    before = studio.config_projection(original)
    env = plan_environment(before, args.phase, args.sheet_id)
    fingerprint = studio.preflight_fingerprint([original, args.phase, args.sheet_id], archive, planned)
    print(json.dumps({'phase': args.phase, 'revision': info['revision'], 'sourceChanges': changes,
                      'preflightSha256': fingerprint, 'sheetsInvoked': False, 'geminiInvoked': False}), flush=True)
    if args.apply_approved is None:
        return
    if fingerprint != args.apply_approved or studio.snapshot(client) != original:
        raise studio.Stop('事前確認の照合値または稼働設定が変化しました')
    studio.submit(client, planned if args.phase == 'stage' else None, environment=env)
    deployed = studio.snapshot(client)
    after_info = studio.matching_runtime(deployed)
    if after_info['revision'] == info['revision']:
        raise studio.Stop('更新後の新リビジョンを確認できません')
    after = studio.config_projection(deployed)
    configuration(after, TEST_SHEET if args.phase == 'stage' else args.sheet_id,
                  args.sheet_id if args.phase == 'stage' else None)
    differences = sorted(k for k in before if before[k] != after[k])
    same_source = runtime.zip_contents(studio.source_archive(client, deployed[0])) == runtime.zip_contents(planned)
    print(json.dumps({'phase': args.phase, 'revision': after_info['revision'], 'sourceMatches': same_source,
                      'unexpectedSettingsDiff': differences}))
    if differences or not same_source:
        raise studio.Stop('予定外の変更を検出しました。再実行前にConsoleで確認してください')


if __name__ == '__main__':
    try:
        main()
    except (studio.Stop, OSError, subprocess.TimeoutExpired, ValueError, TypeError, KeyError, zipfile.BadZipFile) as error:
        print(str(error) if isinstance(error, studio.Stop) else '設定またはソースの照合に失敗しました')
        raise SystemExit(1)
