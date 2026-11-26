#!/usr/bin/env python3
"""New-project-only, opt-in provisioning. No project/billing creation or Gemini calls."""
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys

APIS = ('serviceusage.googleapis.com', 'cloudresourcemanager.googleapis.com',
        'iam.googleapis.com', 'apikeys.googleapis.com',
        'secretmanager.googleapis.com', 'storage.googleapis.com',
        'generativelanguage.googleapis.com')
SECRET = 'material-ai-gemini'
SA = 'material-ai-auth'
KEY = 'material-ai-gemini'
ROLES = {'materialAiMetadata': ['apikeys.keys.get', 'resourcemanager.projects.get'],
         'materialAiBucket': ['storage.buckets.get', 'storage.objects.create', 'storage.objects.get']}

class Stop(Exception):
    pass

def need(condition, code):
    if not condition:
        raise Stop(code)

def project_id(value):
    need(isinstance(value, str) and re.fullmatch(r'yoshilab-material-ai-[a-z0-9]{4,9}', value), 'INVALID_DEDICATED_PROJECT')
    return value

class Cloud:
    def __init__(self, project):
        self.project = project_id(project)

    def call(self, args, data=None):
        # Never inherit HTTP logging or print stdout/stderr/errors from gcloud.
        env = dict(os.environ, CLOUDSDK_CORE_LOG_HTTP='false', CLOUDSDK_CORE_VERBOSITY='error',
                   CLOUDSDK_CORE_DISABLE_PROMPTS='1', CLOUDSDK_STORAGE_MAX_RETRIES='0')
        try:
            p = subprocess.run(['gcloud', *args, '--project=' + self.project,
                                '--quiet', '--format=json'], input=data, capture_output=True,
                               text=True, timeout=300, env=env, check=False)
            need(p.returncode == 0 and len(p.stdout) <= 4 * 1024 * 1024, 'CLOUD_COMMAND_FAILED')
            return json.loads(p.stdout) if p.stdout.strip() else {}
        except Stop:
            raise
        except Exception:
            raise Stop('CLOUD_COMMAND_FAILED') from None

def local_write(path, value, exclusive=True):
    flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC) | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())

def active_principal(cloud):
    accounts = cloud.call(['auth', 'list', '--filter=status:ACTIVE'])
    need(isinstance(accounts, list) and len(accounts) == 1, 'ACTIVE_ACCOUNT_REQUIRED')
    email = accounts[0].get('account', '')
    need(re.fullmatch(r'[a-zA-Z0-9_.+%-]+@[a-zA-Z0-9.-]+', email), 'ACTIVE_ACCOUNT_REQUIRED')
    return ('serviceAccount:' if email.endswith('.gserviceaccount.com') else 'user:') + email

def identity(cloud, fresh=False):
    p = cloud.call(['projects', 'describe', cloud.project])
    number = str(p.get('projectNumber', ''))
    need(p.get('projectId') == cloud.project and re.fullmatch(r'\d{6,20}', number)
         and number != '543561154900' and p.get('lifecycleState') == 'ACTIVE', 'PROJECT_MISMATCH')
    if fresh:
        try:
            created = dt.datetime.fromisoformat(p['createTime'].replace('Z', '+00:00'))
            age = dt.datetime.now(dt.timezone.utc) - created
            need(dt.timedelta(0) <= age <= dt.timedelta(days=7), 'FRESH_PROJECT_REQUIRED')
        except (KeyError, ValueError):
            raise Stop('FRESH_PROJECT_REQUIRED') from None
    billing = cloud.call(['billing', 'projects', 'describe', cloud.project])
    need(billing.get('billingEnabled') is True, 'ADMIN_BILLING_REQUIRED')
    return number

def lists_empty(cloud, number):
    # API enablement is restricted to the explicitly approved, freshly-created project.
    # Disabled-API errors/permission failures are never interpreted as empty lists.
    for args in (['services', 'api-keys', 'list'], ['secrets', 'list'],
                 ['storage', 'buckets', 'list'], ['iam', 'roles', 'list']):
        values = cloud.call(args)
        need(isinstance(values, list) and not values, 'EXISTING_RESOURCES_STOP')
    accounts = cloud.call(['iam', 'service-accounts', 'list'])
    need(isinstance(accounts, list), 'INVENTORY_INVALID')
    for account in accounts:
        need(re.fullmatch(r'service-' + number + r'@gcp-sa-[a-z0-9-]+\.iam\.gserviceaccount\.com',
                          account.get('email', '')), 'EXISTING_SERVICE_ACCOUNT_STOP')

def has_binding(policy, role, member):
    return any(b.get('role') == role and member in b.get('members', []) and not b.get('condition')
               for b in policy.get('bindings', []))

def private_policy(policy):
    need(all(m not in ('allUsers', 'allAuthenticatedUsers') for b in policy.get('bindings', [])
             for m in b.get('members', [])), 'PUBLIC_IAM_STOP')

def verify(cloud, c, member):
    number = identity(cloud)
    need(number == c['projectNumber'] and c['projectId'] == cloud.project, 'PROJECT_MISMATCH')
    enabled = cloud.call(['services', 'list', '--enabled'])
    need(set(APIS) <= {v.get('config', {}).get('name') for v in enabled}, 'API_VERIFICATION_FAILED')
    account = cloud.call(['iam', 'service-accounts', 'describe', SA + '@' + cloud.project + '.iam.gserviceaccount.com'])
    email = SA + '@' + cloud.project + '.iam.gserviceaccount.com'
    need(account.get('email') == email and account.get('disabled') is not True, 'SA_VERIFICATION_FAILED')
    key = cloud.call(['services', 'api-keys', 'describe', c['keyResource']])
    restrictions = key.get('restrictions', {})
    need(key.get('name') == c['keyResource'] and key.get('serviceAccountEmail') == email
         and not key.get('deleteTime') and restrictions.get('apiTargets') == [{'service': 'generativelanguage.googleapis.com'}]
         and not any(restrictions.get(k) for k in ('browserKeyRestrictions', 'serverKeyRestrictions',
                     'androidKeyRestrictions', 'iosKeyRestrictions')), 'AUTH_KEY_VERIFICATION_FAILED')
    secret = cloud.call(['secrets', 'describe', SECRET])
    need(secret.get('name') == 'projects/' + number + '/secrets/' + SECRET
         and secret.get('labels', {}).get('material-ai') == 'isolated-v1', 'SECRET_VERIFICATION_FAILED')
    versions = cloud.call(['secrets', 'versions', 'list', '--secret=' + SECRET])
    expected = 'projects/' + number + '/secrets/' + SECRET + '/versions/' + c['secretVersion']
    need(len(versions) == 1 and versions[0].get('name') == expected and versions[0].get('state') == 'ENABLED', 'SECRET_VERSION_VERIFICATION_FAILED')
    bucket = cloud.call(['storage', 'buckets', 'describe', 'gs://' + c['bucket'], '--raw'])
    iam = bucket.get('iamConfiguration', {})
    need(bucket.get('name') == c['bucket'] and str(bucket.get('projectNumber')) == number
         and iam.get('uniformBucketLevelAccess', {}).get('enabled') is True
         and iam.get('publicAccessPrevention') == 'enforced'
         and bucket.get('location', '').lower() == 'asia-northeast1', 'PRIVATE_BUCKET_VERIFICATION_FAILED')
    bp = cloud.call(['storage', 'buckets', 'get-iam-policy', 'gs://' + c['bucket']])
    sp = cloud.call(['secrets', 'get-iam-policy', SECRET])
    pp = cloud.call(['projects', 'get-iam-policy', cloud.project])
    private_policy(bp)
    private_policy(sp)
    private_policy(pp)
    for rid, perms in ROLES.items():
        role = cloud.call(['iam', 'roles', 'describe', rid])
        need(set(role.get('includedPermissions', [])) == set(perms) and role.get('stage') == 'GA'
             and not role.get('deleted'), 'CUSTOM_ROLE_VERIFICATION_FAILED')
    need(has_binding(bp, 'projects/' + cloud.project + '/roles/materialAiBucket', member)
         and has_binding(sp, 'roles/secretmanager.secretAccessor', member)
         and has_binding(sp, 'roles/secretmanager.viewer', member)
         and has_binding(pp, 'projects/' + cloud.project + '/roles/materialAiMetadata', member), 'IAM_VERIFICATION_FAILED')
    # The auth-key SA receives no storage/secret/project role; don't silently widen it.
    need(not any('serviceAccount:' + email in b.get('members', []) for p in (bp, sp, pp)
                 for b in p.get('bindings', [])), 'AUTH_SA_ROLE_UNEXPECTED')
    return {'verified': True, 'projectId': cloud.project, 'projectNumber': number,
            'keyResource': c['keyResource'], 'secretVersion': c['secretVersion'],
            'geminiRequestsSent': 0, 'appendEnabled': False, 'publishEnabled': False}

def provision(cloud, directory, approved=False):
    need(approved, 'SETUP_APPROVAL_REQUIRED')
    directory = Path(directory)
    # Exclusive local journal: incomplete runs cannot be resumed by recreating secrets/keys.
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    need(not directory.is_symlink() and directory.stat().st_uid == os.getuid()
         and directory.stat().st_mode & 0o077 == 0, 'PRIVATE_STATE_DIRECTORY_REQUIRED')
    journal = {'projectId': cloud.project, 'step': 'preflight', 'complete': False}
    local_write(directory / 'setup-journal.json', journal)
    def step(name, args, data=None):
        journal['step'] = name
        local_write(directory / 'setup-journal.json', journal, exclusive=False)
        # Only fixed labels are emitted; never command responses or secret values.
        print(json.dumps({'setupStep': name}), flush=True)
        return cloud.call(args, data=data)
    number = identity(cloud, fresh=True)
    member = active_principal(cloud)
    journal.update(projectNumber=number, operator=member)
    step('enable-apis', ['services', 'enable', *APIS])
    lists_empty(cloud, number)
    bucket = cloud.project + '-validation'
    # Atomic bucket creation is the cross-shell guard before key/secret/IAM changes.
    step('create-private-bucket', ['storage', 'buckets', 'create', 'gs://' + bucket,
         '--location=asia-northeast1', '--uniform-bucket-level-access', '--public-access-prevention',
         '--labels=material-ai=isolated-v1'])
    email = SA + '@' + cloud.project + '.iam.gserviceaccount.com'
    step('create-auth-sa', ['iam', 'service-accounts', 'create', SA, '--display-name=Material AI isolated auth'])
    # No organization-policy change, unbound fallback, role expansion or retry.
    step('create-auth-key', ['services', 'api-keys', 'create', '--key-id=' + KEY,
         '--service-account=' + email, '--api-target=service=generativelanguage.googleapis.com',
         '--annotations=material-ai=isolated-v1'])
    key_resource = 'projects/' + number + '/locations/global/keys/' + KEY
    key = cloud.call(['services', 'api-keys', 'describe', key_resource])
    need(key.get('name') == key_resource and key.get('serviceAccountEmail') == email
         and key.get('restrictions', {}).get('apiTargets') == [{'service': 'generativelanguage.googleapis.com'}], 'NEW_KEY_MISMATCH')
    step('create-secret', ['secrets', 'create', SECRET, '--replication-policy=automatic', '--labels=material-ai=isolated-v1'])
    # ONLY the key created successfully in this invocation is read, never existing keys.
    value = cloud.call(['services', 'api-keys', 'get-key-string', key_resource]).get('keyString', '')
    need(isinstance(value, str) and 20 <= len(value) <= 4096 and not re.search(r'\s', value), 'NEW_KEY_STRING_INVALID')
    version = step('store-new-key', ['secrets', 'versions', 'add', SECRET, '--data-file=-'], data=value)
    value = None
    need(version.get('name') == 'projects/' + number + '/secrets/' + SECRET + '/versions/1', 'NEW_SECRET_VERSION_MISMATCH')
    for rid, permissions in ROLES.items():
        step('create-scoped-role-' + rid, ['iam', 'roles', 'create', rid, '--title=' + rid,
             '--permissions=' + ','.join(permissions), '--stage=GA'])
    step('grant-project-metadata', ['projects', 'add-iam-policy-binding', cloud.project,
         '--member=' + member, '--role=projects/' + cloud.project + '/roles/materialAiMetadata', '--condition=None'])
    step('grant-bucket-only', ['storage', 'buckets', 'add-iam-policy-binding', 'gs://' + bucket,
         '--member=' + member, '--role=projects/' + cloud.project + '/roles/materialAiBucket', '--condition=None'])
    for role in ('roles/secretmanager.secretAccessor', 'roles/secretmanager.viewer'):
        step('grant-secret-only-' + role.rsplit('/', 1)[1], ['secrets', 'add-iam-policy-binding', SECRET,
             '--member=' + member, '--role=' + role, '--condition=None'])
    c = {'projectId': cloud.project, 'projectNumber': number, 'keyResource': key_resource,
         'secretId': SECRET, 'secretVersion': '1', 'bucket': bucket,
         'modelId': 'gemini-3.8-flash', 'provenanceConfirmed': True}
    journal['config'] = c
    local_write(directory / 'setup-journal.json', journal, exclusive=False)
    result = verify(cloud, c, member)
    local_write(directory / 'config.json', c)
    # Non-secret provenance, immutable create; never touch any isolated-v1 trial claim.
    step('record-provenance', ['storage', 'cp', str(directory / 'config.json'),
         'gs://' + bucket + '/setup-v1/provenance.json', '--if-generation-match=0'])
    journal.update(step='complete', complete=True)
    local_write(directory / 'setup-journal.json', journal, exclusive=False)
    return result

def main(argv):
    mode = argv[0] if argv else 'plan'
    if mode == 'plan':
        print(json.dumps({'offline': True, 'createProject': False, 'configureBilling': False,
              'setupRequiresApproval': True, 'geminiRequestsSent': 0, 'apis': APIS}))
        return
    need(mode in ('setup', 'check') and len(argv) == 2, 'INVALID_ARGUMENTS')
    project = project_id(argv[1])
    directory = Path.home() / '.config' / 'yoshilab-material' / project
    if mode == 'setup':
        need(os.environ.get('MG_SETUP_APPROVED') == project and os.environ.get('MG_COST_CONFIRMED') == 'true', 'SETUP_APPROVAL_REQUIRED')
        result = provision(Cloud(project), directory, approved=True)
    else:
        journal = json.loads((directory / 'setup-journal.json').read_text())
        need(journal.get('projectId') == project and journal.get('config', {}).get('projectId') == project, 'LOCAL_RECORD_REQUIRED')
        result = verify(Cloud(project), journal['config'], journal['operator'])
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (Exception, KeyboardInterrupt) as error:
        # Fixed exception class/code only. Never include traceback, argv or subprocess output.
        code = str(error) if isinstance(error, Stop) else 'SETUP_STOPPED_PRESERVE_RECORDS'
        print(json.dumps({'success': False, 'code': code, 'retryAttempted': False}), file=sys.stderr)
        sys.exit(1)
