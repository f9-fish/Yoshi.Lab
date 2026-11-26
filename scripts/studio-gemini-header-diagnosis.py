#!/usr/bin/env python3
"""Read existing Cloud Run metadata and a bounded log window. Never invoke Gemini."""
import argparse
import json
import re
import subprocess

PROJECT = 'yoshi-lab-db3eb'
REGION = 'asia-northeast1'
WINDOW = ('2026-11-26T03:25:00Z', '2026-11-26T03:33:00Z')
FIELDS = {'elapsedMs', 'headersMs', 'bodyReadyMs', 'upstreamStatus', 'promptTokenCount',
          'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount', 'questionCount',
          'requestedPerType', 'maxOutputTokens', 'timeoutMs'}
ENUMS = {
    'stage': {'headers', 'body', 'validate'},
    'outcome': {'deadline', 'upstream_http_error', 'error', 'success'},
    'profile': {'low', 'default'},
    'finishReason': {'STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'OTHER'},
}


def gcloud(args):
    try:
        result = subprocess.run(['gcloud', *args, '--quiet', '--format=json'], capture_output=True,
                                timeout=35, check=False)
        if result.returncode:
            raise ValueError
        return json.loads(result.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        raise RuntimeError('読み取り失敗。Cloud Shellの参照権限と接続を確認してください') from None


def diagnostics(entries):
    rows = []
    requests = []
    for item in entries:
        timestamp = item.get('timestamp', '')
        revision = item.get('resource', {}).get('labels', {}).get('revision_name', '')
        if not re.fullmatch(r'2026-11-26T03:[0-9:.]+Z', timestamp) or not re.fullmatch(r'studioapi-[a-z0-9-]+', revision):
            continue
        current = {'timestamp': timestamp, 'revision': revision}
        which = item.get('logName', '')
        if which.endswith('/run.googleapis.com%2Frequests'):
            req = item.get('httpRequest', {})
            if req.get('status') == 504 and req.get('requestMethod') == 'POST':
                latency = req.get('latency', '')
                if re.fullmatch(r'[0-9]+(?:\.[0-9]+)?s', latency):
                    current['latency'] = latency
                requests.append({**current, 'status': 504})
            continue
        payload = item.get('jsonPayload')
        if not isinstance(payload, dict):
            try:
                payload = json.loads(item.get('textPayload', ''))
            except (TypeError, ValueError):
                continue
        if not isinstance(payload, dict) or payload.get('event') != 'studio_gemini_generation':
            continue
        current.update({key: val for key, val in payload.items()
                        if key in FIELDS and type(val) is int and val >= 0})
        current.update({key: val for key, val in payload.items()
                        if key in ENUMS and isinstance(val, str) and val in ENUMS[key]})
        rows.append(current)
    return {'generation': rows, 'http504': requests,
            'note': '時刻による候補一覧です。共通traceが確認できない場合は同一リクエストの証明になりません。'}


def settings(revision):
    spec = revision.get('spec', {})
    env = {entry.get('name'): entry for container in spec.get('containers', [])
           for entry in container.get('env', [])}
    ref = env.get('STUDIO_GEMINI_API_KEY', {}).get('valueFrom', {}).get('secretKeyRef', {})
    annotations = revision.get('metadata', {}).get('annotations', {})
    vpc = any(k in annotations for k in ('run.googleapis.com/vpc-access-connector', 'run.googleapis.com/network-interfaces'))
    egress = annotations.get('run.googleapis.com/vpc-access-egress')
    model = env.get('STUDIO_GEMINI_MODEL', {}).get('value')
    return {'modelMatches': model == 'gemini-3.8-flash', 'secretReferencePresent': bool(ref.get('name') and ref.get('key')),
            'vpcConfigured': vpc, 'vpcEgress': egress if egress in ('all-traffic', 'private-ranges-only') else None,
            'proxyVariablesPresent': any(isinstance(k, str) and k.lower() in ('https_proxy', 'http_proxy', 'no_proxy') for k in env)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--key-project', help='作成記録で確認済みのAPIキープロジェクトIDのみ')
    args = parser.parse_args()
    if args.key_project and not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]', args.key_project):
        parser.error('確認済みのプロジェクトIDを指定してください')
    filters = ('resource.type="cloud_run_revision" AND resource.labels.service_name="studioapi" '
               f'AND timestamp>="{WINDOW[0]}" AND timestamp<"{WINDOW[1]}" '
               'AND (jsonPayload.event="studio_gemini_generation" OR '
               'textPayload:"studio_gemini_generation" OR '
               '(log_id("run.googleapis.com/requests") AND httpRequest.status=504))')
    entries = gcloud(['logging', 'read', filters, '--project', PROJECT, '--limit=100'])
    report = diagnostics(entries)
    report['limitMayHaveTruncated'] = len(entries) >= 100
    revisions = {entry['revision'] for category in ('generation', 'http504') for entry in report[category]}
    report['incidentRevisions'] = {}
    for name in sorted(revisions):
        try:
            report['incidentRevisions'][name] = settings(gcloud(
                ['run', 'revisions', 'describe', name, '--project', PROJECT, '--region', REGION]))
        except RuntimeError:
            report['incidentRevisions'][name] = {'verified': False}
    if args.key_project:
        enabled = gcloud(['services', 'list', '--enabled', '--project', args.key_project,
                          '--filter=config.name:generativelanguage.googleapis.com'])
        report['confirmedProjectApiEnabled'] = any(
            service.get('config', {}).get('name') == 'generativelanguage.googleapis.com' for service in enabled)
    report['keyProject'] = args.key_project
    report['geminiInvoked'] = False
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        print(error)
        raise SystemExit(1)
