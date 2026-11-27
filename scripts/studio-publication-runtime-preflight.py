#!/usr/bin/env python3
"""Read-only PR #108 runtime check, with separately approved source-only update and rollback."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

spec = importlib.util.spec_from_file_location('question_deploy',Path(__file__).with_name('studio-question-master-deployment.py'))
question = importlib.util.module_from_spec(spec)
spec.loader.exec_module(question)
studio, runtime = question.studio, question.runtime
BEFORE = 'fe321dcb39f71364b5489123c9763826f11c2717'
AFTER = 'e121093c8b02186905d287a3ea141f4821a0e517'
FILE = 'index.js'


def plan_update(archive, previous, reviewed):
    if {name for name in reviewed if reviewed[name] != previous[name]} != {FILE}:
        raise studio.Stop('PR #108 の実行ソース差分が index.js だけではありません')
    return question.source_plan(archive, {'pre-pr108':previous,'pr108':reviewed},reviewed)


def connection_status(state):
    settings = state[0]['serviceConfig']
    deployed = state[2]
    fn_environment = settings.get('environmentVariables', {})
    rev_environment = {item['name']:item.get('value') for item in deployed['containers'][0]['env']}
    required = ('STUDIO_MASTER_SPREADSHEET_ID','STUDIO_MASTER_READER_SERVICE_ACCOUNT',question.SHEET,question.WRITER)
    names = (*required,question.PILOT,question.READ_ONLY)
    if any(fn_environment.get(name) != rev_environment.get(name) for name in names):
        raise studio.Stop('現在の本文・問題マスター設定が関数と稼働リビジョンで一致しません')
    if (settings.get('serviceAccountEmail') != runtime.RUNTIME or deployed.get('serviceAccount') != runtime.RUNTIME):
        raise studio.Stop('稼働サービスアカウントが既知の設定と一致しません')
    return {'textbookMasterConfigured': all(fn_environment.get(name) for name in required[:2]),
            'questionMasterConfigured': all(fn_environment.get(name) for name in required[2:]),
            'sharedPublicationConfigured': bool(all(fn_environment.get(name) for name in required[2:]) and
                                                not fn_environment.get(question.PILOT) and
                                                fn_environment.get(question.READ_ONLY) != 'true')}


def restore_plan(client, receipt, archive, projection, previous, reviewed):
    if (question.content_hash(archive) != receipt['installedHash'] or
        question.audit.digest(projection) != receipt['configurationHash']):
        raise studio.Stop('適用後にソースまたは設定が変更されています。自動復旧を停止します')
    backup = studio.source_archive(client,{'buildConfig':{'sourceProvenance':{'resolvedStorageSource':receipt['source']}}})
    if hashlib.sha256(backup).hexdigest() != receipt['archiveSha256']:
        raise studio.Stop('元ソースの世代または内容を検証できません')
    baseline, _, _ = plan_update(backup,previous,reviewed)
    if baseline != 'pre-pr108':
        raise studio.Stop('復旧ソースが PR #108 適用前の版と一致しません')
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase',choices=('check','rollback'),nargs='?',default='check')
    parser.add_argument('--apply-approved',metavar='PREFLIGHT_SHA256')
    parser.add_argument('--receipt',type=Path,default=Path('studio-pr108-before.json'))
    args = parser.parse_args()
    if args.apply_approved is not None and not re.fullmatch(r'[a-f0-9]{64}',args.apply_approved):
        raise studio.Stop('読み取り専用の事前確認で得た照合値を指定してください')
    studio.command('git','fetch','--quiet','origin','+refs/heads/main:refs/remotes/origin/main')
    previous = runtime.source_at(BEFORE,question.FILES)
    reviewed = runtime.source_at(AFTER,question.FILES)
    if runtime.source_at('origin/main',question.FILES) != reviewed:
        raise studio.Stop('最新mainの実行ファイルにPR #108以外の差分があります')
    client = studio.Client()
    original = studio.snapshot(client)
    info = studio.matching_runtime(original)
    connections = connection_status(original)
    archive = studio.source_archive(client,original[0])
    before = studio.config_projection(original)
    baseline, changes, planned = plan_update(archive,previous,reviewed)
    if args.phase == 'rollback':
        if baseline != 'pr108':
            raise studio.Stop('PR #108 の稼働版を確認できません')
        planned = restore_plan(client,json.loads(args.receipt.read_text()),archive,before,previous,reviewed)
        changes = [FILE]
    fingerprint = studio.preflight_fingerprint([original,args.phase],archive,planned)
    print(json.dumps({'revision':info['revision'],'phase':args.phase,'runtimeSource':baseline,
        'pr108Deployed':baseline=='pr108','sourceChanges':changes,'preflightSha256':fingerprint,
        **connections}),flush=True)
    if args.apply_approved is None or not changes:
        return
    if args.apply_approved != fingerprint or studio.snapshot(client) != original:
        raise studio.Stop('照合値または稼働設定が変化しました。事前確認をやり直してください')
    if args.phase == 'check':
        source = original[0]['buildConfig']['sourceProvenance']['resolvedStorageSource']
        receipt = {'source':source,'installedHash':question.content_hash(planned),
                   'archiveSha256':hashlib.sha256(archive).hexdigest(),'configurationHash':question.audit.digest(before)}
        fd = os.open(args.receipt,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w') as file:
            json.dump(receipt,file)
    studio.submit(client,planned)
    after = studio.snapshot(client)
    ready = studio.matching_runtime(after)
    settings = studio.config_projection(after)
    differences = sorted(name for name in before if before[name]!=settings[name])
    verified = question.content_hash(studio.source_archive(client,after[0]))==question.content_hash(planned)
    print(json.dumps({'revision':ready['revision'],'sourceMatches':verified,'unexpectedSettingsDiff':differences}))
    if ready['revision']==info['revision'] or not verified or differences:
        raise studio.Stop('新リビジョンまたは設定の照合に失敗しました。再実行前にConsoleで確認してください')


if __name__ == '__main__':
    try:
        main()
    except (studio.Stop,OSError,subprocess.TimeoutExpired,ValueError,TypeError,KeyError,zipfile.BadZipFile) as error:
        print(str(error) if isinstance(error,studio.Stop) else '稼働ソースまたは設定の確認に失敗しました')
        raise SystemExit(1)
