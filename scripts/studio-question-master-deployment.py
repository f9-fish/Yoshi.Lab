#!/usr/bin/env python3
"""Compare deployed source/settings and prepare an explicitly approved Gen 2 update."""
import argparse
import hashlib
import importlib.util
import os
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
REVIEWED = '3af12972'
PR103 = '83f1478f'
CONFIRMED_WRITER = 'yoshilab-question-writer@yoshi-lab-db3eb.iam.gserviceaccount.com'
TOKEN_ROLE = 'roles/iam.serviceAccountTokenCreator'
TOKEN_PERMISSION = 'iam.serviceAccounts.getAccessToken'
SHEET, WRITER = audit.KEYS
CUSTOM_ROLE = 'projects/yoshi-lab-db3eb/roles/yoshilabQuestionAccessToken'
PILOT = 'STUDIO_QUESTION_MASTER_PILOT_TEACHER_UID'
READ_ONLY = 'STUDIO_QUESTION_MASTER_CONNECTION_ONLY'
KEYS = (*audit.KEYS, PILOT, READ_ONLY)
PROTECTED_SHEETS = {
    runtime.SETTINGS['STUDIO_MASTER_SPREADSHEET_ID'],
    '1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU',
}


def source_plan(archive, baselines, target, *, allowed_changes=None):
    live = runtime.zip_contents(archive)
    baseline = next((label for label, files in baselines.items()
                     if all(live.get(name) == files.get(name) for name in FILES)), None)
    if not baseline:
        raise studio.Stop('稼働ソースが既知の版と一致しません。変更を停止します')
    changes = [name for name in FILES if live.get(name) != target[name]]
    if set(changes) - (allowed_changes if allowed_changes is not None else {'index.js', audit.NEW_FILE}):
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


def writer_access(client, writer):
    account = 'projects/yoshi-lab-db3eb/serviceAccounts/' + writer
    resource = '//iam.googleapis.com/' + account
    iam = 'https://iam.googleapis.com/v1/'
    member = 'serviceAccount:' + runtime.RUNTIME
    direct_roles = None
    try:
        policy = client.json(iam + account + ':getIamPolicy', 'POST', {'options': {'requestedPolicyVersion': 3}})
        direct_roles = sorted(binding['role'] for binding in policy.get('bindings', [])
                              if not binding.get('condition') and member in binding.get('members', []))
    except studio.Stop:
        pass

    custom_verified = False
    if CUSTOM_ROLE in (direct_roles or []):
        try:
            role = client.json(iam + CUSTOM_ROLE)
            custom_verified = (role.get('includedPermissions') == [TOKEN_PERMISSION] and
                               not role.get('deleted') and role.get('stage') != 'DISABLED')
        except studio.Stop:
            pass
    state = None
    effective = 'unverified'
    diagnostic = {'outcome': 'response_state_missing_or_invalid'}
    try:
        result = client.json('https://policytroubleshooter.googleapis.com/v3/iam:troubleshoot', 'POST',
                             {'accessTuple': {'principal': runtime.RUNTIME, 'fullResourceName': resource,
                                              'permission': TOKEN_PERMISSION}},
                             extra_headers={'x-goog-user-project': 'yoshi-lab-db3eb'},
                             collect_api_error=True)
        raw_state = result.get('overallAccessState') if isinstance(result,dict) else None
        if raw_state in ('CAN_ACCESS','CANNOT_ACCESS','UNKNOWN_INFO','UNKNOWN_CONDITIONAL'):
            state = raw_state
            diagnostic = {'outcome': 'evaluated'}
            if state in ('CAN_ACCESS', 'CANNOT_ACCESS'):
                effective = 'granted' if state == 'CAN_ACCESS' else 'denied'
    except studio.ApiFailure as error:
        diagnostic = error.diagnostic
    except studio.Stop:
        diagnostic = {'outcome': 'request_failed'}
    except ValueError:
        diagnostic = {'outcome': 'invalid_json'}
    return {'directTokenCreator': None if direct_roles is None else TOKEN_ROLE in direct_roles,
            'directRoleCount': None if direct_roles is None else len(direct_roles),
            'directExactCustomRole': custom_verified,
            'policyState': state, 'effectiveGetAccessToken': effective, 'policyDiagnostic': diagnostic}


def allow_apply(phase, access, accept_unknown, confirmed):
    if phase not in ('connect', 'activate'):
        return
    if phase == 'activate' and not confirmed:
        raise studio.Stop('先に教員画面の読み取り接続確認を完了してください')
    if access['effectiveGetAccessToken'] == 'granted':
        return
    if (access['effectiveGetAccessToken'] == 'unverified' and accept_unknown and
            access.get('directExactCustomRole') and access.get('policyState') == 'UNKNOWN_INFO'):
        return
    raise studio.Stop('短命トークンの実効権限が確認できないため適用を停止します')


def content_hash(archive):
    return audit.digest({name: hashlib.sha256(data).hexdigest()
                         for name,data in runtime.zip_contents(archive).items()})


def make_receipt(function, archive, planned, projection, additions):
    source = function['buildConfig']['sourceProvenance']['resolvedStorageSource']
    return {'source': source, 'archiveHash': hashlib.sha256(archive).hexdigest(),
            'settingsHash': audit.digest(projection), 'connectionHash': audit.digest(additions),
            'installedHash': content_hash(planned)}


def restore_source(client, receipt, projection, expected, baselines):
    if (audit.digest(projection) != receipt['settingsHash'] or
        audit.digest(expected) != receipt['connectionHash']):
        raise studio.Stop('接続前の記録と既存設定または接続先が一致しません')
    previous = studio.source_archive(client, {'buildConfig': {'sourceProvenance': {
        'resolvedStorageSource': receipt['source']}}})
    if hashlib.sha256(previous).hexdigest() != receipt['archiveHash']:
        raise studio.Stop('接続前アーカイブの照合に失敗しました')
    files = runtime.zip_contents(previous)
    if not any(all(files.get(name)==baseline.get(name) for name in FILES) for baseline in baselines.values()):
        raise studio.Stop('復旧元のソースを確認できません')
    return previous


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('pilot', 'production', 'connect', 'activate', 'rollback', 'diagnose-iam'))
    parser.add_argument('--sheet-id')
    parser.add_argument('--writer')
    parser.add_argument('--pilot-uid')
    parser.add_argument('--pilot-sheet-id')
    parser.add_argument('--pilot-writer')
    parser.add_argument('--apply-approved', metavar='PREFLIGHT_SHA256')
    parser.add_argument('--receipt', type=Path, default=Path('studio-question-master-before.json'))
    parser.add_argument('--accept-unverified-iam', action='store_true')
    parser.add_argument('--connection-verified', action='store_true')
    args = parser.parse_args()
    if args.phase == 'diagnose-iam':
        if any((args.sheet_id,args.writer,args.pilot_uid,args.pilot_sheet_id,args.pilot_writer,
                args.apply_approved,args.accept_unverified_iam,args.connection_verified)):
            parser.error('diagnose-iam は追加引数を使いません')
        access = writer_access(studio.Client(), CONFIRMED_WRITER)
        print(json.dumps({'stage':'writer-iam', **access}))
        return
    if args.phase in ('connect', 'activate', 'rollback'):
        if any((args.writer,args.pilot_uid,args.pilot_sheet_id,args.pilot_writer)):
            raise studio.Stop('接続・有効化・復旧では確定済みの書き込み用アカウントを使用します')
        args.writer = CONFIRMED_WRITER
    writer_pattern = r'[a-z][a-z0-9-]+@yoshi-lab-db3eb\.iam\.gserviceaccount\.com'
    if (not re.fullmatch(r'[A-Za-z0-9_-]{20,100}', args.sheet_id or '')
        or not re.fullmatch(writer_pattern, args.writer or '')
        or (args.phase in ('pilot', 'production') and not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', args.pilot_uid or ''))):
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
    if latest not in (reviewed, target) or any(target[n]!=reviewed[n] for n in FILES if n not in ('index.js', audit.NEW_FILE)):
        raise studio.Stop('最新mainまたは更新対象に別の関数ソース変更があります')
    client = studio.Client()
    access = writer_access(client,args.writer) if args.phase in ('connect','activate') else None
    if access is not None:
        print(json.dumps({'stage':'writer-iam',**access}), flush=True)
    original = studio.snapshot(client)
    info = studio.matching_runtime(original)
    archive = studio.source_archive(client, original[0])
    known = {'known-runtime': runtime.source_at(audit.BASELINE), 'pr103': runtime.source_at(PR103, FILES),
             'pr104': reviewed, 'target': target}
    baselines = known if args.phase in ('pilot','connect') else {'target': target}
    baseline, changes, planned = source_plan(archive, baselines, target)
    before = studio.config_projection(original)
    current = {}
    if args.phase == 'production':
        current = {SHEET: args.pilot_sheet_id, WRITER: args.pilot_writer, PILOT: args.pilot_uid}
    if args.phase in ('activate','rollback'):
        current = {SHEET: args.sheet_id, WRITER: args.writer}
        if args.phase == 'activate' or original[0].get('serviceConfig', {}).get('environmentVariables', {}).get(READ_ONLY) == 'true':
            current[READ_ONLY] = 'true'
    env = settings(before, current)
    additions = desired(env, args.sheet_id, args.writer, args.pilot_uid if args.phase=='pilot' else None)
    if args.phase == 'connect':
        additions[READ_ONLY] = 'true'
    if args.phase == 'rollback':
        receipt = json.loads(args.receipt.read_text())
        if content_hash(archive) != receipt['installedHash']:
            raise studio.Stop('接続時に反映したソースと現在のソースが一致しません')
        planned = restore_source(client, receipt, before, {**additions,READ_ONLY:'true'}, known)
        old_files, restored_files = runtime.zip_contents(archive), runtime.zip_contents(planned)
        changes = sorted(name for name in old_files.keys()|restored_files.keys()
                         if old_files.get(name)!=restored_files.get(name))
        additions = {}
    fingerprint = studio.preflight_fingerprint([original,args.phase,additions,access], archive, planned)
    print(json.dumps({'phase':args.phase,'revision':info['revision'],'sourceBaseline':baseline,'sourceChanges':changes,
                      'environmentChanges':sorted(key for key in KEYS if current.get(key)!=additions.get(key)),
                      'preflightSha256':fingerprint,'writerIam':access,'sheetsInvoked':False}), flush=True)
    if args.apply_approved is None:
        return
    allow_apply(args.phase,access,args.accept_unverified_iam,args.connection_verified)
    if args.apply_approved != fingerprint or studio.snapshot(client) != original:
        raise studio.Stop('照合値または稼働設定が変化しました。事前確認をやり直してください')
    if args.phase == 'connect':
        receipt = make_receipt(original[0],archive,planned,before,additions)
        fd = os.open(args.receipt, os.O_CREAT|os.O_EXCL|os.O_WRONLY, 0o600)
        with os.fdopen(fd,'w') as file:
            json.dump(receipt,file)
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
