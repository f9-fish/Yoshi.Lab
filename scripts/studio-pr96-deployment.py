#!/usr/bin/env python3
"""Read-only preflight by default. An approved invocation can patch only the Gen 2 source."""
import argparse
import hashlib
import io
import json
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

BASE = '13c6579080822e050386c2fcf2caa60fbc311ab9'
PATCH = '90bcd4e357474713ae7488a9cbe384a6d8f2a571'
PARENT = 'projects/yoshi-lab-db3eb/locations/asia-northeast1'
FUNCTION = PARENT + '/functions/studioApi'
SERVICE = PARENT + '/services/studioapi'
EXPECTED_REV = 'studioapi-00002-caz'
HOST = 'https://studioapi-bfaa4wjjga-an.a.run.app'
GCF = 'https://cloudfunctions.googleapis.com/v2/'
RUN = 'https://run.googleapis.com/v2/'
SOURCE_FILES = ('index.js', 'studio-core.cjs', 'package.json', 'package-lock.json')
MAX_ARCHIVE = 100 * 1024 * 1024


class Stop(Exception):
    pass


class ApiFailure(Stop):
    SAFE_STATUSES = {'INVALID_ARGUMENT', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND',
                     'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'INTERNAL', 'UNAVAILABLE', 'DEADLINE_EXCEEDED'}
    SAFE_REASONS = {'SERVICE_DISABLED', 'USER_PROJECT_DENIED', 'CONSUMER_INVALID', 'BILLING_DISABLED',
                    'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'IAM_PERMISSION_DENIED', 'ACCESS_DENIED',
                    'RATE_LIMIT_EXCEEDED', 'QUOTA_EXCEEDED', 'API_KEY_SERVICE_BLOCKED',
                    'SECURITY_POLICY_VIOLATED', 'VPC_SERVICE_CONTROLS', 'SERVICE_NOT_VISIBLE'}

    def __init__(self, method, error):
        super().__init__(f'{method} が拒否または失敗しました（HTTP {error.code}）。再実行前に状態を確認してください')
        self.diagnostic = {'outcome': 'http_error', 'httpStatus': error.code}
        try:
            raw = error.read(32_769)
            if len(raw) > 32_768:
                return
            payload = json.loads(raw)['error']
            if payload.get('status') in self.SAFE_STATUSES:
                self.diagnostic['status'] = payload['status']
            reasons = {item.get('reason') for item in payload.get('details', [])
                       if isinstance(item,dict) and item.get('@type') == 'type.googleapis.com/google.rpc.ErrorInfo'
                       and isinstance(item.get('reason'),str) and item['reason'] in self.SAFE_REASONS}
            if reasons:
                self.diagnostic['reasons'] = sorted(reasons)
        except (ValueError, TypeError, KeyError, AttributeError, OSError):
            pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def command(*args):
    try:
        result = subprocess.run(args, capture_output=True, timeout=35, check=False)
    except FileNotFoundError:
        raise Stop(f'{args[0]} がありません。Google Cloud Shellで実行してください') from None
    if result.returncode:
        raise Stop('gcloudまたはGitを実行できません。Cloud Shellのログイン・権限・取得したコミットを確認してください')
    return result.stdout


class Client:
    def __init__(self):
        self.token = command('gcloud', 'auth', 'print-access-token', '--quiet').decode().strip()
        if not self.token:
            raise Stop('Cloud ShellでGoogleアカウントにログインしてください')
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, url, method='GET', body=None, *, signed=False, limit=2_000_000, extra_headers=None, collect_api_error=False):
        headers = dict(extra_headers or {})
        if not signed:
            headers['Authorization'] = 'Bearer ' + self.token
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            with self.opener.open(request, timeout=45) as response:
                data = response.read(limit + 1)
        except urllib.error.HTTPError as error:
            if collect_api_error:
                raise ApiFailure(method, error) from None
            raise Stop(f'{method} が拒否または失敗しました（HTTP {error.code}）。再実行前に状態を確認してください') from None
        except (OSError, TimeoutError):
            raise Stop(f'{method} の接続を確認できません。再実行前に状態を確認してください') from None
        if len(data) > limit:
            raise Stop('応答サイズが上限を超えました')
        return data

    def json(self, url, method='GET', body=None, **options):
        return json.loads(self.request(url, method, body, **options))


def snapshot(client):
    function = client.json(GCF + FUNCTION)
    service = client.json(RUN + SERVICE)
    revision = service.get('latestReadyRevision', '').rsplit('/', 1)[-1]
    if not re.fullmatch(r'studioapi-[a-z0-9-]+', revision):
        raise Stop('稼働リビジョンを確認できません')
    deployed = client.json(RUN + PARENT + '/services/studioapi/revisions/' + revision)
    function_iam = client.json(GCF + FUNCTION + ':getIamPolicy?options.requestedPolicyVersion=3')
    run_iam = client.json(RUN + SERVICE + ':getIamPolicy?options.requestedPolicyVersion=3')
    return function, service, deployed, function_iam, run_iam


def matching_runtime(state, expected_revision=None):
    function, service, revision, _, run_iam = state
    revision_name = revision['name'].rsplit('/', 1)[-1]
    config = function.get('serviceConfig', {})
    traffic = [item for item in service.get('trafficStatuses', []) if item.get('percent', 0)]
    routing = service.get('traffic', [])
    if (function.get('name') != FUNCTION or function.get('environment') != 'GEN_2' or
            function.get('state') != 'ACTIVE' or service.get('name') != SERVICE or
            config.get('service') != SERVICE or HOST not in [service.get('uri'), *service.get('urls', [])] or
            service.get('reconciling') is True or revision_name != service.get('latestCreatedRevision', '').rsplit('/', 1)[-1] or
            (expected_revision and revision_name != expected_revision) or len(traffic) != 1 or
            traffic[0].get('percent') != 100 or traffic[0].get('revision', '').rsplit('/', 1)[-1] != revision_name or
            (routing and routing != [{'type': 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', 'percent': 100}])):
        raise Stop('既存のGen 2関数・URL・稼働状態・最新版への100%ルーティングが想定と一致しません')
    build = function.get('buildConfig', {})
    if build.get('entryPoint') != 'studioApi' or build.get('runtime') != 'nodejs22' or len(revision.get('containers', [])) != 1:
        raise Stop('Node.js 22 / studioApi の構成を確認できません')
    env = {item['name']: item for item in revision['containers'][0].get('env', [])}
    model = env.get('STUDIO_GEMINI_MODEL', {}).get('value', '').strip()
    origin_values = env.get('STUDIO_ALLOWED_ORIGINS', {}).get('value', '')
    cors_ok = 'https://f9-fish.github.io' in {value.strip().rstrip('/') for value in origin_values.split(',')}
    refs = {name: bool(env.get(name, {}).get('valueSource', {}).get('secretKeyRef'))
            for name in ('STUDIO_GEMINI_API_KEY', 'STUDIO_GITHUB_TOKEN')}
    if model != 'gemini-3.8-flash' or not cors_ok or not all(refs.values()):
        raise Stop('モデル・PagesのCORS・既存のSecret参照が想定と一致しません')
    public_invoker = any(entry.get('role') == 'roles/run.invoker' and not entry.get('condition') and
                         'allUsers' in entry.get('members', []) for entry in run_iam.get('bindings', []))
    return {'revision': revision_name, 'model': model, 'pagesCors': cors_ok,
            'runtime': build['runtime'], 'timeoutSeconds': config.get('timeoutSeconds'),
            'runInvokerPublic': public_invoker, 'invokerIamDisabled': service.get('invokerIamDisabled') is True,
            'iapEnabled': service.get('iapEnabled') is True,
            'secretReferencesPresent': refs, 'environmentNames': sorted(env), 'trafficPercent': 100}


def config_projection(state):
    function, service, revision, function_iam, run_iam = state
    build = {k: v for k, v in function.get('buildConfig', {}).items()
             if k not in ('build', 'source', 'sourceProvenance')}
    policy = build.get('onDeployUpdatePolicy')
    if isinstance(policy, dict):
        build['onDeployUpdatePolicy'] = {k: v for k, v in policy.items() if k != 'runtimeVersion'}
    function_config = {k: v for k, v in function.get('serviceConfig', {}).items() if k not in ('uri', 'revision')}
    # Project Cloud Run policy/routing and runtime settings. Keep all environment values
    # and IAM members in memory for comparison only.
    service_config = {k: service.get(k) for k in (
        'ingress', 'invokerIamDisabled', 'iapEnabled', 'traffic', 'scaling', 'defaultUriDisabled', 'binaryAuthorization')}
    runtime = {k: revision.get(k) for k in (
        'timeout', 'maxInstanceRequestConcurrency', 'serviceAccount', 'vpcAccess', 'scaling',
        'executionEnvironment', 'encryptionKey', 'volumes')}
    runtime['containers'] = []
    for original in revision['containers']:
        container = {k: v for k, v in original.items() if k not in ('image', 'buildInfo')}
        container['env'] = sorted(container.get('env', []), key=lambda item: item['name'])
        runtime['containers'].append(container)

    def policy_view(policy):
        return {**{k: v for k, v in policy.items() if k not in ('etag', 'bindings')},
                'bindings': sorted([{**entry, 'members': sorted(entry.get('members', []))}
                                    for entry in policy.get('bindings', [])], key=lambda item: json.dumps(item, sort_keys=True))}

    return {'build': build, 'function': function_config, 'functionLabels': function.get('labels', {}),
            'runService': service_config, 'runRevision': runtime,
            'functionIam': policy_view(function_iam), 'runIam': policy_view(run_iam)}


def source_archive(client, function):
    source = function.get('buildConfig', {}).get('sourceProvenance', {}).get('resolvedStorageSource', {})
    if not all(source.get(field) for field in ('bucket', 'object', 'generation')):
        raise Stop('現行アーカイブの固定世代を確認できません')
    quote = urllib.parse.quote
    url = ('https://storage.googleapis.com/download/storage/v1/b/' + quote(source['bucket'], safe='') +
           '/o/' + quote(source['object'], safe='') + '?alt=media&generation=' + quote(str(source['generation']), safe=''))
    return client.request(url, limit=MAX_ARCHIVE)


def known_legacy_index(pr_base):
    fallback_comment = b"// Do not silently switch models when a future deployment loses its runtime setting.\n"
    explicit_model = b"const model=String(process.env.STUDIO_GEMINI_MODEL||'').trim();\n"
    fallback_model = b"const model=process.env.STUDIO_GEMINI_MODEL||'gemini-2.5-flash';\n"
    missing_model_check = (
        "  if(action==='generate'&&!model)return json(res,503,"
        "{error:'AIモデルが未設定です。管理者にSTUDIO_GEMINI_MODELの確認を依頼してください'});\n"
    ).encode()
    if any(pr_base.count(line) != 1 for line in (fallback_comment, explicit_model, missing_model_check)):
        raise Stop('PR #96の基準に既知の3差分を一意に適用できません')
    return (pr_base.replace(fallback_comment, b'', 1)
            .replace(explicit_model, fallback_model, 1)
            .replace(missing_model_check, b'', 1))


def preflight_fingerprint(state, archive, new_index):
    # No configuration values or archive contents are printed or persisted separately.
    manifest = [state, hashlib.sha256(archive).hexdigest(), hashlib.sha256(new_index).hexdigest()]
    return hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def replacement(archive, before, after):
    output = io.BytesIO()
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as old:
            entries = old.infolist()
            if len({entry.filename for entry in entries}) != len(entries) or sum(i.file_size for i in entries) > MAX_ARCHIVE:
                raise Stop('現行ソースのZIP形式を安全に検証できません')
            if any(old.read(name) != before[name] for name in SOURCE_FILES if name != 'index.js'):
                raise Stop('現行ソースの共通ファイルがPR #96の変更前と一致しません。更新を中止します')
            live_index = old.read('index.js')
            if live_index == before['index.js']:
                baseline = 'pr96-base'
            elif live_index == known_legacy_index(before['index.js']):
                baseline = 'known-legacy-model-fallback'
            else:
                raise Stop('現行index.jsがPR #96の変更前または既知の旧版と一致しません。更新を中止します')
            with zipfile.ZipFile(output, 'w') as new:
                new.comment = old.comment
                for entry in entries:
                    new.writestr(entry, after if entry.filename == 'index.js' else old.read(entry))
    except (KeyError, zipfile.BadZipFile) as error:
        raise Stop('元のZIP内の実行ファイルを確認できません') from error
    return output.getvalue(), baseline


def submit(client, data, *, environment=None):
    if data is None:
        if environment is None:
            raise Stop('更新対象がありません')
        return update_function(client, 'serviceConfig.environmentVariables',
                               {'serviceConfig': {'environmentVariables': environment}})
    if len(data) > MAX_ARCHIVE:
        raise Stop('アップロード用ZIPが上限を超えました')
    upload = client.json(GCF + PARENT + '/functions:generateUploadUrl', 'POST', {})
    url, source = upload.get('uploadUrl', ''), upload.get('storageSource')
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != 'https' or parts.netloc != 'storage.googleapis.com' or not source:
        raise Stop('Cloud Functionsの正規アップロード先を確認できません')
    headers = {'Content-Type': 'application/zip'}
    signed_headers = {k.lower(): v for k, v in urllib.parse.parse_qs(parts.query).items()}
    if 'x-goog-content-length-range' in signed_headers.get('x-goog-signedheaders', [''])[0].split(';'):
        headers['x-goog-content-length-range'] = '0,104857600'
    client.request(url, 'PUT', data, signed=True, extra_headers=headers)
    mask = 'buildConfig.source'
    payload = {'buildConfig': {'source': {'storageSource': source}}}
    if environment is not None:
        mask += ',serviceConfig.environmentVariables'
        payload['serviceConfig'] = {'environmentVariables': environment}
    update_function(client, mask, payload)


def update_function(client, mask, payload):
    result = client.json(GCF + FUNCTION + '?updateMask=' + mask, 'PATCH', payload)
    name = result.get('name', '')
    if not re.fullmatch(re.escape(PARENT) + r'/operations/[A-Za-z0-9_.-]+', name):
        raise Stop('更新の操作IDを確認できません。Consoleで状態を確認してください')
    for _ in range(90):
        operation = client.json(GCF + name)
        if operation.get('done'):
            if operation.get('error'):
                raise Stop('更新操作が失敗しました。Consoleでビルドと既存の稼働状態を確認してください')
            return
        time.sleep(10)
    raise Stop('更新の完了待ちを打ち切りました。再実行せずConsoleで状態を確認してください')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply-approved', action='store_true', help='明示承認後のみ。Cloud Functionsのsourceを更新します')
    parser.add_argument('--expected-preflight-sha256', help='読み取り専用の事前確認で得た照合値')
    args = parser.parse_args()
    expected = args.expected_preflight_sha256
    if args.apply_approved and not re.fullmatch(r'[a-f0-9]{64}', expected or ''):
        raise Stop('先に読み取り専用で実行し、確認済みのpreflightSha256を指定してください')
    if expected is not None and not args.apply_approved:
        raise Stop('読み取り専用の場合は引数を指定しないでください')
    command('git', 'fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main')
    command('git', 'merge-base', '--is-ancestor', PATCH, 'origin/main')
    current = {name: command('git', 'show', f'origin/main:studio-functions/{name}') for name in SOURCE_FILES}
    for name in SOURCE_FILES:
        if current[name] != command('git', 'show', f'{PATCH}:studio-functions/{name}'):
            raise Stop('最新mainにPR #96以降の関数ソース変更があるため停止しました')
    before = {name: command('git', 'show', f'{BASE}:studio-functions/{name}') for name in SOURCE_FILES}
    client = Client()
    original = snapshot(client)
    report = matching_runtime(original, EXPECTED_REV)
    print(json.dumps({'stage': 'settings', **report}, ensure_ascii=False), flush=True)
    archive = source_archive(client, original[0])
    plan, baseline = replacement(archive, before, current['index.js'])
    fingerprint = preflight_fingerprint(original, archive, current['index.js'])
    print(json.dumps({'stage': 'preflight', **report, 'currentSourceBaseline': baseline,
                      'currentSourceMatchesPrBase': baseline == 'pr96-base',
                      'preflightSha256': fingerprint, 'patch': PATCH,
                      'liveGeminiRequested': False}, ensure_ascii=False), flush=True)
    if not args.apply_approved:
        return
    if expected != fingerprint:
        raise Stop('確認した照合値と現在の設定・ソースが一致しません。更新を中止しました')
    if snapshot(client) != original:
        raise Stop('事前確認後に関数・IAM・リビジョンが変わりました。更新を中止しました')
    submit(client, plan)
    deployed = snapshot(client)
    new = matching_runtime(deployed)
    if new['revision'] == report['revision']:
        raise Stop('新版がトラフィックを受けていません')
    previous_settings, current_settings = config_projection(original), config_projection(deployed)
    differences = sorted(key for key in previous_settings if previous_settings[key] != current_settings[key])
    after_source = source_archive(client, deployed[0])
    with zipfile.ZipFile(io.BytesIO(after_source)) as actual, zipfile.ZipFile(io.BytesIO(plan)) as intended:
        if set(actual.namelist()) != set(intended.namelist()) or any(
                actual.read(name) != intended.read(name) for name in intended.namelist()):
            raise Stop('新リビジョンのソースが準備した差分と一致しません')
    print(json.dumps({'stage': 'post-deploy', **new, 'configurationDiffSections': differences,
                      'liveGeminiRequested': False}, ensure_ascii=False))
    if differences:
        raise Stop('設定差分が残っています。Geminiの試行前に管理者が確認してください')


if __name__ == '__main__':
    try:
        main()
    except (Stop, OSError, subprocess.TimeoutExpired, ValueError, TypeError, KeyError, zipfile.BadZipFile) as error:
        print(str(error) if isinstance(error, Stop) else '設定またはソースの検証に失敗しました。値は表示していません。')
        raise SystemExit(1)
