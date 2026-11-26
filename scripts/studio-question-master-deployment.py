#!/usr/bin/env python3
"""Compare deployed source/settings and prepare an explicitly approved Gen 2 update."""
import argparse
import importlib.util
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile

spec = importlib.util.spec_from_file_location('question_audit', Path(__file__).with_name('studio-question-master-audit.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
runtime, studio = audit.runtime, audit.studio
FILES = (*runtime.FILES, audit.NEW_FILE)
REVIEWED = '83f1478f'
SHEET, WRITER = audit.KEYS
PILOT = 'STUDIO_QUESTION_MASTER_PILOT_TEACHER_UID'
KEYS = (*audit.KEYS, PILOT)
PROTECTED_SHEETS = {
    runtime.SETTINGS['STUDIO_MASTER_SPREADSHEET_ID'],
    '1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU',
}


def source_plan(archive, baselines, target):
    live = runtime.zip_contents(archive)
    baseline = next((label for label, files in baselines.items()
                     if all(live.get(name) == files.get(name) for name in FILES)), None)
    if not baseline:
        raise studio.Stop('稼働ソースが既知の版と一致しません。変更を停止します')
    changes = [name for name in FILES if live.get(name) != target[name]]
    if set(changes) - {'index.js', audit.NEW_FILE}:
        raise studio.Stop('依存関係または既存モジュールが一致しません')
    if not changes:
        return baseline, changes, archive
    buffer = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(archive)) as old, zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as new:
        new.comment = old.comment
        for entry in old.infolist():
            new.writestr(entry, target[entry.filename] if entry.filename in changes else live[entry.filename])
        for name in changes:
            if name not in live:
                new.writestr(zipfile.ZipInfo(name), target[name])
    return baseline, changes, buffer.getvalue()


def settings(projection, expected):
    function, revision = projection['function'], projection['runRevision']
    if function.get('serviceAccountEmail') != runtime.RUNTIME or revision.get('serviceAccount') != runtime.RUNTIME:
        raise studio.Stop('既存の実行サービスアカウントが想定と異なります')
    environment = dict(function.get('environmentVariables', {}))
    function['environmentVariables'] = environment
    container = revision['containers'][0]
    deployed = {v['name']: v for v in container['env']}
    for key in KEYS:
        value = expected.get(key)
        if environment.get(key) != value or deployed.get(key) != (None if value is None else {'name': key, 'value': value}):
            raise studio.Stop('問題マスターの関数設定と稼働設定が予定した状態に一致しません')
        environment.pop(key, None)
    container['env'] = [v for v in container['env'] if v['name'] not in KEYS]
    return environment


def desired(env, sheet, writer, uid):
    if sheet in PROTECTED_SHEETS or sheet in (env.get('STUDIO_MASTER_SPREADSHEET_ID'), env.get('STUDIO_MASTER_CANDIDATE_SPREADSHEET_ID')):
        raise studio.Stop('本文マスターのシートは保存先に指定できません')
    if writer in (env.get('STUDIO_MASTER_READER_SERVICE_ACCOUNT'), runtime.SETTINGS['STUDIO_MASTER_READER_SERVICE_ACCOUNT']):
        raise studio.Stop('本文閲覧用アカウントは保存用に指定できません')
    return {SHEET: sheet, WRITER: writer, **({PILOT: uid} if uid else {})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('pilot', 'production'))
    parser.add_argument('--sheet-id', required=True)
    parser.add_argument('--writer', required=True)
    parser.add_argument('--pilot-uid', required=True)
    parser.add_argument('--pilot-sheet-id')
    parser.add_argument('--pilot-writer')
    parser.add_argument('--apply-approved', metavar='PREFLIGHT_SHA256')
    args = parser.parse_args()
    writer_pattern = r'[a-z][a-z0-9-]+@yoshi-lab-db3eb\.iam\.gserviceaccount\.com'
    if (not re.fullmatch(r'[A-Za-z0-9_-]{20,100}', args.sheet_id)
        or not re.fullmatch(writer_pattern, args.writer)
        or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', args.pilot_uid)):
        raise studio.Stop('シートID、専用サービスアカウント、試験教員UIDを確認してください')
    if args.apply_approved is not None and not re.fullmatch(r'[a-f0-9]{64}', args.apply_approved):
        raise studio.Stop('読み取り専用の事前確認で得た照合値を指定してください')
    if args.phase == 'production':
        if (not re.fullmatch(r'[A-Za-z0-9_-]{20,100}', args.pilot_sheet_id or '')
            or not re.fullmatch(writer_pattern, args.pilot_writer or '')
            or args.pilot_sheet_id == args.sheet_id or args.pilot_writer == args.writer):
            raise studio.Stop('試験と本番にそれぞれ別のシートと専用アカウントを指定してください')
    elif args.pilot_sheet_id or args.pilot_writer:
        raise studio.Stop('pilot では --pilot-sheet-id と --pilot-writer は不要です')

    studio.command('git', 'fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main')
    target = runtime.source_at('HEAD', FILES)
    reviewed = runtime.source_at(REVIEWED, FILES)
    latest = runtime.source_at('origin/main', FILES)
    if latest not in (reviewed, target) or any(target[n]!=reviewed[n] for n in FILES if n!='index.js'):
        raise studio.Stop('最新mainまたは更新対象に別の関数ソース変更があります')
    client = studio.Client()
    original = studio.snapshot(client)
    info = studio.matching_runtime(original)
    archive = studio.source_archive(client, original[0])
    baselines = ({'known-runtime': runtime.source_at(audit.BASELINE), 'pr103': reviewed, 'target': target}
                 if args.phase == 'pilot' else {'target': target})
    baseline, changes, planned = source_plan(archive, baselines, target)
    before = studio.config_projection(original)
    current = {} if args.phase == 'pilot' else {SHEET: args.pilot_sheet_id, WRITER: args.pilot_writer, PILOT: args.pilot_uid}
    env = settings(before, current)
    additions = desired(env, args.sheet_id, args.writer, args.pilot_uid if args.phase=='pilot' else None)
    fingerprint = studio.preflight_fingerprint([original,args.phase,additions], archive, planned)
    print(json.dumps({'phase':args.phase,'revision':info['revision'],'sourceBaseline':baseline,'sourceChanges':changes,
                      'environmentChanges':sorted(key for key in KEYS if current.get(key)!=additions.get(key)),
                      'preflightSha256':fingerprint,'sheetsInvoked':False}), flush=True)
    if args.apply_approved is None:
        return
    if args.apply_approved != fingerprint or studio.snapshot(client) != original:
        raise studio.Stop('照合値または稼働設定が変化しました。事前確認をやり直してください')
    studio.submit(client, planned if changes else None, environment={**env,**additions})
    deployed = studio.snapshot(client)
    after_info = studio.matching_runtime(deployed)
    after = studio.config_projection(deployed)
    settings(after, additions)
    differences = sorted(key for key in before if before[key]!=after[key])
    source_matches = runtime.zip_contents(studio.source_archive(client,deployed[0])) == runtime.zip_contents(planned)
    print(json.dumps({'revision':after_info['revision'],'sourceMatches':source_matches,'unexpectedSettingsDiff':differences}))
    if after_info['revision']==info['revision'] or not source_matches or differences:
        raise studio.Stop('新リビジョンまたは設定を確認できません。再実行前にConsoleで確認してください')


if __name__ == '__main__':
    try:
        main()
    except (studio.Stop,OSError,subprocess.TimeoutExpired,ValueError,TypeError,KeyError,zipfile.BadZipFile) as error:
        print(str(error) if isinstance(error,studio.Stop) else 'ソースまたは設定の確認に失敗しました')
        raise SystemExit(1)
