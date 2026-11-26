#!/usr/bin/env bash
# Explicit manual stages. No Firebase deploy, Apps Script changes, or GitHub trigger.
set -euo pipefail
cd "$(dirname "$0")/../../.."
project=yoshi-lab-db3eb
region=asia-northeast1
service=yoshilab-material-test01
runtime_sa=yoshilab-material-test01@yoshi-lab-db3eb.iam.gserviceaccount.com
repository=yoshilab-material-test01
ops=material-generation/ops/test01
command -v gcloud >/dev/null || { echo 'Google Cloud Shellで実行してください。'; exit 1; }
case "${1:-}" in
  audit)
    gcloud auth list --filter=status:ACTIVE --format='value(account)'
    gcloud iam service-accounts describe "$runtime_sa" --project="$project" --format='yaml(email,disabled)'
    gcloud projects get-iam-policy "$project" --flatten='bindings[].members' --filter="bindings.members:serviceAccount:$runtime_sa" --format='table(bindings.role,bindings.condition)'
    gcloud builds get-default-service-account --project="$project" --region="$region"
    gcloud services list --enabled --project="$project" --format='value(config.name)'
    ;;
  prepare)
    gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project="$project"
    # Readable only by authorized identities; never a public repository.
    if ! gcloud artifacts repositories describe "$repository" --location="$region" --project="$project" >/dev/null; then
      gcloud artifacts repositories create "$repository" --repository-format=docker --location="$region" --project="$project" --description='Yoshi.Lab TEST01 manual preflight images'
    fi
    ;;
  build)
    git diff --quiet && git diff --cached --quiet || { echo 'コミット済みのコードを使用してください。'; exit 1; }
    revision=$(git rev-parse HEAD)
    image="$region-docker.pkg.dev/$project/$repository/preflight:$revision"
    context=$(mktemp -d)
    trap 'rm -rf "$context"' EXIT
    # Upload only tracked engine files; no local secrets, .git, or unrelated app data.
    git archive HEAD material-generation | tar -x -C "$context"
    # BuildKit is enabled inside cloudbuild.yaml, not via the caller shell.
    echo "Cloud BuildのDockerステップ内でDOCKER_BUILDKIT=1を設定してビルドします。"
    gcloud builds submit "$context" --project="$project" --region="$region" --config="$ops/cloudbuild.yaml" --substitutions="_IMAGE=$image"
    echo "ビルド完了。次に実行: bash $ops/manual-cloud-run.sh deploy"
    ;;
  deploy)
    revision=$(git rev-parse HEAD)
    image="$region-docker.pkg.dev/$project/$repository/preflight:$revision"
    digest=$(gcloud artifacts docker images describe "$image" --project="$project" --format='value(image_summary.digest)')
    [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'ビルド済みのイメージdigestを確認できません。'; exit 1; }
    # Application validates Google's signature, audience and Firebase teacher role.
    # allow-unauthenticated is ONLY for this named test service, not studioapi.
    gcloud run deploy "$service" --project="$project" --region="$region" \
      --image="${image%:*}@$digest" --service-account="$runtime_sa" \
      --env-vars-file="$ops/preflight.env.yaml" --clear-secrets \
      --port=8080 --cpu=1 --memory=512Mi --min-instances=0 --max-instances=1 \
      --concurrency=1 --timeout=120 --cpu-throttling --allow-unauthenticated \
      --labels=purpose=material-test01,mode=preflight
    echo 'デプロイ済み。次に verify を実行してください。'
    ;;
  verify)
    snapshot=$(mktemp)
    trap 'rm -f "$snapshot"' EXIT
    gcloud run services describe "$service" --project="$project" --region="$region" --format=json > "$snapshot"
    python3 - "$snapshot" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]));spec=s['spec']['template']['spec'];c=spec['containers'][0]
e={v['name']:v.get('value') for v in c.get('env',[])}
expected={'MG_MODE':'TEST','MG_PREFLIGHT_ENABLED':'true','MG_ENABLED':'false','MG_TEST_APPEND_ENABLED':'false','MG_AUTH_VERIFIED':'false','MG_STORAGE_VERIFIED':'false','MG_TEST_SPREADSHEET_ID':'1DhOMLWw9nlMvNLRuT32vCN0A69GnaREWZqLZJyFLERc','MG_GOOGLE_AUDIENCE':'484749540864-95miu3q2sndsm80oi4cron53hm0v16gc.apps.googleusercontent.com'}
assert all(e.get(k)==v for k,v in expected.items()), '環境変数が接続確認モードと一致しません'
assert spec['serviceAccountName']=='yoshilab-material-test01@yoshi-lab-db3eb.iam.gserviceaccount.com'
assert not any(v.get('valueFrom') for v in c.get('env',[])), 'Secret参照が残っています'
assert s['status']['latestReadyRevisionName']==s['status']['latestCreatedRevisionName'], '新リビジョンが未準備です'
assert all(t.get('revisionName',s['status']['latestReadyRevisionName'])==s['status']['latestReadyRevisionName'] for t in s['status'].get('traffic',[]) if t.get('percent',0)), '旧リビジョンへトラフィックがあります'
print('接続確認設定OK。生成・追記は無効。URL: '+s['status']['url'])
PY
    url=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["status"]["url"])' "$snapshot")
    status=$(curl --silent --show-error --max-time 30 --output /dev/null --write-out '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' "$url/preflight")
    [[ "$status" == 401 ]] || { echo "未認証リクエストが401になりません: $status"; exit 1; }
    echo '未認証リクエストの拒否OK。Apps Scriptの接続確認へ進んでください。'
    ;;
  *) echo "Usage: bash $ops/manual-cloud-run.sh {audit|prepare|build|deploy|verify}"; exit 2 ;;
esac
