#!/usr/bin/env python3
"""Read-only metadata/metrics audit. No Secret payload, key-string or Gemini endpoint access."""
import fnmatch
import json
import math
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

PROJECT = 'yoshi-lab-db3eb'
MODEL = 'gemini-3.8-flash'
SERVICE = 'generativelanguage.googleapis.com'
START = '2026-11-11T15:00:00Z'  # Nov 12 00:00 JST
END = '2026-11-12T15:00:00Z'    # Nov 13 00:00 JST
METRICS = [
    ('request-count', 'serviceruntime.googleapis.com/api/request_count', 'resource.type="consumed_api" AND resource.labels.service="generativelanguage.googleapis.com"'),
    ('request-latency', 'serviceruntime.googleapis.com/api/request_latencies', 'resource.type="consumed_api" AND resource.labels.service="generativelanguage.googleapis.com"'),
    ('output-tokens', 'generativelanguage.googleapis.com/generate_content_usage_output_token_count', 'metric.labels.model="gemini-3.8-flash"'),
    ('quota-exceeded', 'serviceruntime.googleapis.com/quota/exceeded', 'resource.type="consumer_quota" AND resource.labels.service="generativelanguage.googleapis.com"'),
]


def number(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) and 0 <= result <= 1e15 else None
    except (TypeError, ValueError):
        return None


def timestamp(value):
    return value if isinstance(value, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z', value) else None


def key_summary(data):
    keys = data if isinstance(data, list) else data.get('keys', [])
    out = []
    for key in keys[:100]:
        targets = key.get('restrictions', {}).get('apiTargets', [])
        matching = [t for t in targets if t.get('service') == SERVICE]
        methods = [m for t in matching for m in t.get('methods', []) if isinstance(m, str)]
        # API methods permit suffix wildcards. Report only a boolean, never arbitrary method text.
        candidates = ['GenerateContent', 'GenerativeService.GenerateContent',
                      'google.ai.generativelanguage.v1beta.GenerativeService.GenerateContent']
        allowed = bool(matching) and (any(not t.get('methods') for t in matching) or
                                      any(fnmatch.fnmatchcase(c.lower(), p.lower()) for p in methods for c in candidates))
        restrictions = key.get('restrictions', {})
        resource = key.get('name', '')
        out.append({
            'resource': resource if isinstance(resource, str) and re.fullmatch(r'projects/\d+/locations/global/keys/[A-Za-z0-9_-]+', resource) else None,
            'deleted': bool(key.get('deleteTime')),
            'authKeyServiceAccountBound': bool(key.get('serviceAccountEmail')),
            'apiRestricted': bool(targets),
            'generativeLanguageExplicitlyAllowed': bool(matching),
            'generateContentAllowedByListedMethods': allowed if targets else None,
            'browserRestricted': 'browserKeyRestrictions' in restrictions,
            'serverIpRestricted': 'serverKeyRestrictions' in restrictions,
            'mobileRestricted': any(k in restrictions for k in ('androidKeyRestrictions', 'iosKeyRestrictions')),
        })
    return {'section': 'api-key-metadata', 'keys': out,
            'secretPayloadToKeyAssociation': 'UNVERIFIED_NO_SECRET_READ',
            'listedProjectIsActualGeminiKeyProject': 'UNVERIFIED', 'truncated': len(keys) > 100}


def metric_summary(kind, data):
    series = data.get('timeSeries', [])
    out = {'section': kind, 'seriesCount': len(series), 'dataPresent': bool(series),
           'scope': 'PROJECT_AGGREGATE_NOT_TEST_ONLY', 'complete': not bool(data.get('nextPageToken'))}
    if kind == 'request-count':
        total, codes, generation_total, generation_codes = 0, {}, 0, {}
        for s in series:
            code = str(s.get('metric', {}).get('labels', {}).get('response_code', ''))
            code = code if re.fullmatch(r'[1-5]\d\d', code) else 'unknown'
            count = sum(number(p.get('value', {}).get('int64Value')) or 0 for p in s.get('points', []))
            total += count
            codes[code] = codes.get(code, 0) + count
            method = s.get('resource', {}).get('labels', {}).get('method', '')
            if isinstance(method, str) and re.search(r'(?:\.|/)GenerateContent$', method, re.I):
                generation_total += count
                generation_codes[code] = generation_codes.get(code, 0) + count
        failures = sum(v for k, v in generation_codes.items() if k.startswith('5'))
        known_codes = all(k != 'unknown' for k in generation_codes)
        complete_rate = out['complete'] and generation_total > 0 and known_codes
        out.update(allApiMethodCountsByCode=codes, generateContentCountsByCode=generation_codes,
                   generateContentRequestCount=generation_total if series and out['complete'] else None,
                   generateContent5xxRate=failures / generation_total if complete_rate else None,
                   rateIsComplete=complete_rate)
    elif kind == 'request-latency':
        # Distribution means can be weighted; percentiles cannot be recovered from means.
        weight, value = 0, 0
        for s in series:
            for p in s.get('points', []):
                d = p.get('value', {}).get('distributionValue', {})
                count, mean = number(d.get('count')), number(d.get('mean'))
                if count and mean is not None:
                    weight += count
                    value += count * mean
        out.update(sampleCount=weight, weightedMeanSeconds=value / weight if weight else None,
                   percentileAvailable=False)
    elif kind == 'output-tokens':
        out['outputTokensObserved'] = sum(number(p.get('value', {}).get('int64Value')) or 0 for s in series for p in s.get('points', [])) if series else None
    else:
        values = [p.get('value', {}).get('boolValue') for s in series for p in s.get('points', [])]
        out['quotaExceededObserved'] = any(v is True for v in values) if values else None
    return out


def gcloud(args):
    result = subprocess.run(['gcloud'] + args, capture_output=True, timeout=45, check=False)
    if result.returncode:
        raise RuntimeError('READ_FAILED')
    if len(result.stdout) > 8 * 1024 * 1024:
        raise RuntimeError('READ_TOO_LARGE')
    return json.loads(result.stdout)


def valid_project(project):
    return isinstance(project, str) and bool(re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]', project))


def monitoring_get(metric, extra, token, fetch=urllib.request.urlopen, project=PROJECT):
    if not valid_project(project):
        raise ValueError('INVALID_PROJECT')
    params = {'filter': f'metric.type="{metric}" AND {extra}', 'interval.startTime': START,
              'interval.endTime': END, 'view': 'FULL', 'pageSize': '10000'}
    url = 'https://monitoring.googleapis.com/v3/projects/' + project + '/timeSeries?' + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token}, method='GET')
    # No retry or redirect: even an unexpected endpoint must not receive the token.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect()) if fetch is urllib.request.urlopen else None
    with (opener.open(request, timeout=30) if opener else fetch(request, timeout=30)) as response:
        body = response.read(8 * 1024 * 1024 + 1)
    if len(body) > 8 * 1024 * 1024:
        raise RuntimeError('READ_TOO_LARGE')
    return json.loads(body)


def emit(value):
    print(json.dumps(value, ensure_ascii=False, separators=(',', ':')), flush=True)


def read(section, operation):
    try:
        emit(operation())
    except urllib.error.HTTPError as error:
        emit({'section': section, 'readStatus': 'HTTP_READ_FAILED', 'httpStatus': error.code})
    except Exception:
        emit({'section': section, 'readStatus': 'READ_FAILED'})


def main(api_project=PROJECT):
    if not valid_project(api_project):
        raise ValueError('INVALID_PROJECT')
    # Every operation is a GET/list/cat/describe. No Secret versions access, getKeyString,
    # lookupKey, Gemini API/model endpoint, service enable, IAM mutation or generation.
    read('billing', lambda: {'section': 'billing', 'project': api_project,
         'billingEnabled': gcloud(['billing', 'projects', 'describe', api_project, '--format=json']).get('billingEnabled') is True,
         'geminiKeyProjectConfirmed': False})
    read('enabled-api', lambda: {'section': 'enabled-api',
         'generativeLanguageEnabled': any(s.get('config', {}).get('name') == SERVICE for s in gcloud(['services', 'list', '--enabled', '--project=' + api_project, '--format=json']))})
    read('api-key-metadata', lambda: key_summary(gcloud(['services', 'api-keys', 'list', '--project=' + api_project, '--format=json'])))
    for env, job in [('TEST01', 'JOB-b888236ffcfcd39446e41e5e09e4fd70'), ('TEST03', 'JOB-dcb7e4afbc33a3565fb44a022b5cdcb2')]:
        suffix = env.lower()
        prefix = 'material-generation-test' if env == 'TEST01' else 'material-generation-test03'
        base = 'gs://' + PROJECT + '-material-' + suffix + '-jobs/' + prefix + '/'
        def times(env=env, base=base, job=job):
            j = gcloud(['storage', 'cat', base + job + '.json'])
            c = gcloud(['storage', 'cat', base + 'PHASE4-' + env + '.json'])
            return {'section': 'trial-times', 'environment': env, 'jobMatches': j.get('id') == job,
                    'claimMatches': c.get('jobId') == job, 'createdAt': timestamp(j.get('createdAt')),
                    'attemptedAt': timestamp(c.get('attemptedAt')), 'attempted': c.get('attempted') is True}
        read('trial-times-' + env, times)
    # Use normal Cloud Shell user credentials. Token stays in memory, never args/output/files.
    try:
        token_result = subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, timeout=30, check=False)
        if token_result.returncode:
            raise RuntimeError('AUTH_FAILED')
        token = token_result.stdout.decode().strip()
        if not token or '\n' in token:
            raise RuntimeError('AUTH_FAILED')
    except Exception:
        emit({'section': 'metrics', 'readStatus': 'AUTH_UNAVAILABLE'})
    else:
        for kind, metric, extra in METRICS:
            read(kind, lambda kind=kind, metric=metric, extra=extra: metric_summary(kind, monitoring_get(metric, extra, token, project=api_project)))
    emit({'section': 'boundary', 'secretPayloadRead': False, 'geminiRequestSent': False,
          'cloudChanges': False, 'testRecordsChanged': False, 'apiProject': api_project,
          'runtimeProject': PROJECT, 'windowStartUtc': START, 'windowEndUtc': END})


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args:
        main()
    elif len(args) == 2 and args[0] == '--api-project' and valid_project(args[1]):
        main(args[1])
    else:
        print('確認済みのプロジェクトIDを --api-project で指定してください。入力値は表示しません。', file=sys.stderr)
        sys.exit(2)
