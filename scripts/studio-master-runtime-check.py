#!/usr/bin/env python3
"""Read-only preflight, with a separately approved update for the existing studioApi."""
import argparse
import importlib.util
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile

spec = importlib.util.spec_from_file_location('studio_deployment', Path(__file__).with_name('studio-pr96-deployment.py'))
studio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(studio)

MODULE = 'textbook-master.cjs'
FILES = (*studio.SOURCE_FILES, MODULE)
PR99 = 'e3f82c2199d54061e97095346a5ceddfd1d8abca'
PR100 = 'bad118fa3ba6285014ebbd4fac1653e7501e7074'
RUNTIME = '543561154900-compute@developer.gserviceaccount.com'
SETTINGS = {
    'STUDIO_MASTER_READER_SERVICE_ACCOUNT': 'yoshilab-textbook-reader@yoshi-lab-db3eb.iam.gserviceaccount.com',
    'STUDIO_MASTER_SPREADSHEET_ID': '1ClfR5S6qYTCbKOjjs4Aq3KFQjnOH2QIhysMpppv5_1Q',
}


def source_at(ref, names=FILES):
    return {name: studio.command('git', 'show', f'{ref}:studio-functions/{name}') for name in names}


def zip_contents(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len({entry.filename for entry in entries}) != len(entries) or sum(e.file_size for e in entries) > studio.MAX_ARCHIVE:
            raise studio.Stop('ソースZIPの形式を確認できません')
        return {entry.filename: archive.read(entry) for entry in entries}


def plan_source(data, baselines, target):
    contents = zip_contents(data)
    live = {name: contents[name] for name in FILES if name in contents}
    baseline = next((label for label, files in baselines.items() if live == files), None)
    if baseline is None:
        raise studio.Stop('現行の実行ファイルが既知の版と一致しません。更新を停止します')
    changed = [name for name in FILES if live.get(name) != target[name]]
    if set(changed) - {'index.js', MODULE}:
        raise studio.Stop('依存関係または共通ファイルに未承認の差分があります')
    if not changed:
        return baseline, changed, data
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as old, zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as new:
        new.comment = old.comment
        for entry in old.infolist():
            new.writestr(entry, target[entry.filename] if entry.filename in changed else contents[entry.filename])
        for name in changed:
            if name not in contents:
                new.writestr(zipfile.ZipInfo(name), target[name])
    return baseline, changed, output.getvalue()


def configure(projection, *, after=False):
    config = projection['function']
    runtime = projection['runRevision']
    if runtime['serviceAccount'] != RUNTIME or config.get('serviceAccountEmail') != RUNTIME:
        raise studio.Stop('Cloud Runの実行サービスアカウントが確認済みのアカウントと一致しません')
    environment = config.setdefault('environmentVariables', {})
    container = runtime['containers'][0]
    runtime_env = {entry['name']: entry for entry in container['env']}
    for name, value in SETTINGS.items():
        expected = (value, {'name': name, 'value': value}) if after else (None, None)
        if (environment.get(name), runtime_env.get(name)) != expected:
            raise studio.Stop('本文マスターの環境変数が予定した状態と一致しません')
        environment.pop(name, None)
    container['env'] = [entry for entry in container['env'] if entry['name'] not in SETTINGS]
    return {**environment, **SETTINGS}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply-approved', metavar='PREFLIGHT_SHA256')
    args = parser.parse_args()
    expected = args.apply_approved
    if expected is not None and not re.fullmatch(r'[a-f0-9]{64}', expected):
        raise studio.Stop('読み取り専用の事前確認で得た照合値を指定してください')
    studio.command('git', 'fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main')
    target = source_at('HEAD')
    checked_in = source_at(PR100)
    latest = source_at('origin/main')
    if latest not in (checked_in, target) or any(target[n] != checked_in[n] for n in FILES if n != 'index.js'):
        raise studio.Stop('最新mainまたは更新対象の関数ソースに未確認の変更があります')
    baselines = {
        'runtime-check': target, 'pr100': checked_in, 'pr99': source_at(PR99),
        'pr96': source_at(studio.PATCH, studio.SOURCE_FILES),
    }
    client = studio.Client()
    original = studio.snapshot(client)
    report = studio.matching_runtime(original)
    archive = studio.source_archive(client, original[0])
    baseline, changed, planned = plan_source(archive, baselines, target)
    print(json.dumps({'stage': 'source', 'revision': report['revision'], 'sourceBaseline': baseline,
                      'pr99ReaderPresent': baseline != 'pr96', 'sourceChanges': changed}), flush=True)
    before = studio.config_projection(original)
    settings = configure(before)
    fingerprint = studio.preflight_fingerprint([original, SETTINGS], archive, planned)
    print(json.dumps({'stage': 'preflight', 'preflightSha256': fingerprint,
                      'environmentAdditions': sorted(SETTINGS), 'geminiInvoked': False}), flush=True)
    if expected is None:
        return
    if expected != fingerprint or studio.snapshot(client) != original:
        raise studio.Stop('照合値または現行設定が変わりました。変更せず停止します')
    studio.submit(client, planned, environment=settings)
    deployed = studio.snapshot(client)
    deployed_info = studio.matching_runtime(deployed)
    if deployed_info['revision'] == report['revision']:
        raise studio.Stop('新リビジョンへのトラフィック切り替えを確認できません')
    after = studio.config_projection(deployed)
    configure(after, after=True)
    differences = sorted(key for key in before if before[key] != after[key])
    source_ok = zip_contents(studio.source_archive(client, deployed[0])) == zip_contents(planned)
    print(json.dumps({'stage': 'post-deploy', 'revision': deployed_info['revision'],
                      'sourceMatches': source_ok, 'unexpectedSettingsDiff': differences, 'geminiInvoked': False}))
    if differences or not source_ok:
        raise studio.Stop('予定外の差分があります。再実行せずConsoleで確認してください')


if __name__ == '__main__':
    try:
        main()
    except (studio.Stop, OSError, subprocess.TimeoutExpired, ValueError, TypeError, KeyError, zipfile.BadZipFile) as error:
        print(str(error) if isinstance(error, studio.Stop) else 'ソースまたは設定を検証できませんでした')
        raise SystemExit(1)
