#!/usr/bin/env bash
# Manual TEST01 stages only. Never run with bash -x (Secret pipe).
set -euo pipefail
set +x
umask 077
cd "$(dirname "$0")/../../.."
project=yoshi-lab-db3eb
region=asia-northeast1
service=yoshilab-material-test01
runtime_sa=yoshilab-material-test01@yoshi-lab-db3eb.iam.gserviceaccount.com
bucket=yoshi-lab-db3eb-material-test01-jobs
secret=yoshilab-material-test01-gemini
ops=material-generation/ops/test01
stage=${1:-check}
model=${MG_MODEL_ID:-gemini-3.8-flash}
version=${MG_SECRET_VERSION:-}
command -v gcloud >/dev/null || { echo 'Cloud Shellで実行してください'; exit 1; }
[[ "$version" =~ ^[1-9][0-9]*$ ]] || { echo 'MG_SECRET_VERSIONに対象Secretの有効な数値バージョンを指定してください（latestは禁止）'; exit 1; }
[[ "$model" =~ ^gemini-[a-zA-Z0-9._-]+$ ]] || exit 1
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
check() {
  # Read ONLY the existing test service; no need to inspect studioapi again.
  gcloud run services describe "$service" --project="$project" --region="$region" --format='value(spec.template.spec.serviceAccountName)' > "$scratch/sa"
  [[ "$(cat "$scratch/sa")" == "$runtime_sa" ]] || { echo '既存テスト実行IDが不一致です'; exit 1; }
  gcloud billing projects describe "$project" --format='value(billingEnabled)' | grep -qx True || { echo '課金状態を確認してください'; exit 1; }
  gcloud secrets versions describe "$version" --secret="$secret" --project="$project" --format='value(state)' | grep -qx ENABLED
  # GET models only, not generateContent. Never display/copy an existing secret value.
  gcloud secrets versions access "$version" --secret="$secret" --project="$project" | node material-generation/phase4/verify-model.cjs "$model"
}
confirmed() {
 [[ "${MG_COST_CONFIRMED:-}" == true && "${MG_ADMIN_CONFIRMED:-}" == true ]] || { echo '課金・Gemini価格/利用制限・対象モデル・対象IAM/Secretを確認後、MG_COST_CONFIRMED=true MG_ADMIN_CONFIRMED=trueを指定してください'; exit 1; }
}
prepare() {
  confirmed
  gcloud services enable storage.googleapis.com secretmanager.googleapis.com --project="$project"
  # Listing must succeed; an arbitrary permission failure must not be mistaken for absence.
  existing=$(gcloud storage buckets list --project="$project" --filter="name=$bucket" --format='value(name)')
  if [[ -z "$existing" ]]; then
    gcloud storage buckets create "gs://$bucket" --project="$project" --location="$region" --uniform-bucket-level-access --public-access-prevention
    gcloud storage buckets update "gs://$bucket" --update-labels=purpose=material-test01
  fi
  gcloud storage buckets describe "gs://$bucket" --format=json > "$scratch/bucket.json"
  python3 - "$scratch/bucket.json" <<'PY'
import json,sys
b=json.load(open(sys.argv[1]))
assert b.get('name')=='yoshi-lab-db3eb-material-test01-jobs'
assert b.get('labels',{}).get('purpose')=='material-test01','既存バケットの用途を確認してください。自動変更しません'
# gcloud storage uses snake_case resource keys.
assert b.get('public_access_prevention')=='enforced','PAP必須'
assert b.get('uniform_bucket_level_access') is True,'Uniform bucket-level access必須'
assert not b.get('retention_policy'),'保持ポリシーによるロック削除不能を避けてください'
PY
  # Resource-level grants only. Existing Firebase read roles remain untouched.
  gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member="serviceAccount:$runtime_sa" --role=roles/storage.objectUser --condition=None >/dev/null
  gcloud secrets add-iam-policy-binding "$secret" --project="$project" --member="serviceAccount:$runtime_sa" --role=roles/secretmanager.secretAccessor --condition=None >/dev/null
}
deploy() {
  confirmed
  git diff --quiet && git diff --cached --quiet || { echo 'コミット済みのコードを使用してください'; exit 1; }
  revision=$(git rev-parse HEAD)
  image="$region-docker.pkg.dev/$project/yoshilab-material-test01/preflight:$revision"
  digest=$(gcloud artifacts docker images describe "$image" --project="$project" --format='value(image_summary.digest)')
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
  # Generate a non-secret config outside the repo; safe template stays OFF.
  cp "$ops/generation.env.yaml" "$scratch/generation.yaml"
  cat >> "$scratch/generation.yaml" <<YAML
MG_PHASE4_SINGLE_JOB: "true"
MG_MODEL_VERIFIED: "true"
MG_COST_CONFIRMED: "true"
YAML
  python3 - "$scratch/generation.yaml" "$bucket" "$model" <<'PY'
import sys
p=sys.argv[1];s=open(p).read()
for k,v in {'MG_ENABLED':'true','MG_AUTH_VERIFIED':'true','MG_STORAGE_VERIFIED':'true','MG_GOOGLE_AUDIENCE':'484749540864-95miu3q2sndsm80oi4cron53hm0v16gc.apps.googleusercontent.com','MG_GCS_BUCKET':sys.argv[2],'MG_GEMINI_MODEL':sys.argv[3],'MG_DAILY_LIMIT':'1'}.items():
 import re
 s,n=re.subn(r'^'+k+r':.*$',k+': "'+v+'"',s,flags=re.M);assert n==1
open(p,'w').write(s)
PY
  # Service must already exist; do not change invoker IAM or production services.
  gcloud run services describe "$service" --project="$project" --region="$region" --format='value(metadata.name)' >/dev/null
  gcloud run deploy "$service" --project="$project" --region="$region" --image="${image%:*}@$digest" \
    --service-account="$runtime_sa" --env-vars-file="$scratch/generation.yaml" \
    --set-secrets="MG_GEMINI_API_KEY=$secret:$version" --port=8080 --cpu=1 --memory=512Mi \
    --min-instances=0 --max-instances=1 --concurrency=1 --timeout=120 --cpu-throttling \
    --labels=purpose=material-test01,mode=phase4 --quiet
}
verify() {
  gcloud run services describe "$service" --project="$project" --region="$region" --format=json > "$scratch/run.json"
  python3 - "$scratch/run.json" "$model" "$version" "$bucket" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]));spec=s['spec']['template']['spec'];c=spec['containers'][0]
e={v['name']:v.get('value') for v in c.get('env',[])}
expected={'MG_MODE':'TEST','MG_ENABLED':'true','MG_PREFLIGHT_ENABLED':'false','MG_TEST_APPEND_ENABLED':'false','MG_PHASE4_SINGLE_JOB':'true','MG_AUTH_VERIFIED':'true','MG_STORAGE_VERIFIED':'true','MG_MODEL_VERIFIED':'true','MG_COST_CONFIRMED':'true','MG_DAILY_LIMIT':'1','MG_GEMINI_MODEL':sys.argv[2],'MG_GCS_BUCKET':sys.argv[4],'MG_STORE_BACKEND':'gcs','MG_TEST_SPREADSHEET_ID':'1DhOMLWw9nlMvNLRuT32vCN0A69GnaREWZqLZJyFLERc','MG_GOOGLE_AUDIENCE':'484749540864-95miu3q2sndsm80oi4cron53hm0v16gc.apps.googleusercontent.com'}
assert all(e.get(k)==v for k,v in expected.items()),'環境変数不一致'
assert spec['serviceAccountName']=='yoshilab-material-test01@yoshi-lab-db3eb.iam.gserviceaccount.com'
key=next(v for v in c['env'] if v['name']=='MG_GEMINI_API_KEY')
assert 'value' not in key
assert key['valueFrom']['secretKeyRef']=={'name':'yoshilab-material-test01-gemini','key':sys.argv[3]}
assert s['status']['latestReadyRevisionName']==s['status']['latestCreatedRevisionName']
assert all(t.get('revisionName')==s['status']['latestReadyRevisionName'] for t in s['status'].get('traffic',[]) if t.get('percent',0)),'旧リビジョンへのトラフィックを確認してください'
print('Phase 4設定OK。追記・公開無効。URL: '+s['status']['url'])
PY
  url=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["status"]["url"])' "$scratch/run.json")
  status=$(curl --silent --show-error --max-time 30 --output /dev/null --write-out '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' "$url/step")
  [[ "$status" == 401 ]] || { echo "未認証拒否が401ではありません: $status"; exit 1; }
}
case "$stage" in
  check) check ;;
  prepare) check; prepare ;;
  deploy) check; deploy; verify ;;
  verify) verify ;;
  setup-deploy) confirmed; check; prepare; bash "$ops/manual-cloud-run.sh" build; deploy; verify ;;
  export)
    job=${2:-}; [[ "$job" =~ ^JOB-[a-f0-9]{32}$ ]] || { echo '実行ログのジョブIDを指定してください'; exit 1; }
    dest=$(mktemp -d "${TMPDIR:-/tmp}/yoshilab-phase4-review.XXXXXX")
    gcloud storage cp "gs://$bucket/material-generation-test/$job.json" "$dest/job.json" >/dev/null
    node material-generation/phase4/review.cjs "$dest/job.json" > "$dest/review.json"
    echo "私有ローカル評価資料: $dest/review.json （教材本文を含むためGitHub・公開ログへ貼らない）"
    ;;
  *) echo "Usage: $0 {check|prepare|setup-deploy|deploy|verify|export JOB-id}"; exit 2 ;;
esac
