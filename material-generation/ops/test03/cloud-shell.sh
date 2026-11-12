#!/usr/bin/env bash
# Manual TEST03 only. No TEST01 service/bucket/job mutations; no generateContent call.
set -euo pipefail
set +x
umask 077
cd "$(dirname "$0")/../../.."
project=yoshi-lab-db3eb
region=asia-northeast1
service=yoshilab-material-test03
runtime_sa=yoshilab-material-test03@yoshi-lab-db3eb.iam.gserviceaccount.com
bucket=yoshi-lab-db3eb-material-test03-jobs
secret=yoshilab-material-test01-gemini
repository=yoshilab-material-test03
role=yoshiLabMaterialTest03Reader
ops=material-generation/ops/test03
stage=${1:-verify}
version=${MG_SECRET_VERSION:-}
audience=${MG03_GOOGLE_AUDIENCE:-}
command -v gcloud >/dev/null || { echo 'Cloud Shellで実行してください'; exit 1; }
[[ "$version" =~ ^[1-9][0-9]*$ ]] || { echo 'MG_SECRET_VERSIONは有効な数値を指定してください'; exit 1; }
[[ "$audience" =~ ^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$ ]] || { echo 'mg03InspectのaudienceをMG03_GOOGLE_AUDIENCEへ指定してください'; exit 1; }
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
confirmed() {
 [[ "${MG_ADMIN_CONFIRMED:-}" == true && "${MG_COST_CONFIRMED:-}" == true && "${MG_FIREBASE_READ_CONFIRMED:-}" == true ]] || { echo '管理者が費用・対象IAM/Secret・Firebaseの読取範囲を確認し、3つの確認フラグをtrueにしてください'; exit 1; }
}
check() {
 gcloud billing projects describe "$project" --format='value(billingEnabled)' | grep -qx True
 gcloud secrets versions describe "$version" --secret="$secret" --project="$project" --format='value(state)' | grep -qx ENABLED
 # Model metadata GET only. No paid generation, key copy, or key display.
 gcloud secrets versions access "$version" --secret="$secret" --project="$project" | node material-generation/phase4/verify-model.cjs gemini-3.8-flash
}
prepare() {
 gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com storage.googleapis.com secretmanager.googleapis.com iam.googleapis.com --project="$project"
 existing=$(gcloud iam service-accounts list --project="$project" --filter="email=$runtime_sa" --format='value(email)')
 if [[ -z "$existing" ]]; then gcloud iam service-accounts create "$service" --project="$project" --display-name='Yoshi.Lab isolated TEST03'; fi
 gcloud iam service-accounts describe "$runtime_sa" --project="$project" --format=json | node "$ops/config.cjs" sa
 gcloud projects get-iam-policy "$project" --format=json | node "$ops/config.cjs" project-iam
 # Exact two read permissions. Never copy all TEST01 roles, grant Editor, or change RTDB Rules.
 existing=$(gcloud iam roles list --project="$project" --filter="name=projects/$project/roles/$role" --format='value(name)')
 if [[ -z "$existing" ]]; then gcloud iam roles create "$role" --project="$project" --title='Yoshi.Lab TEST03 teacher read' --permissions=firebaseauth.users.get,firebasedatabase.instances.get --stage=GA; fi
 gcloud iam roles describe "$role" --project="$project" --format=json | node "$ops/config.cjs" role
 gcloud projects add-iam-policy-binding "$project" --member="serviceAccount:$runtime_sa" --role="projects/$project/roles/$role" --condition=None >/dev/null
 existing=$(gcloud storage buckets list --project="$project" --filter="name=$bucket" --format='value(name)')
 if [[ -z "$existing" ]]; then
  gcloud storage buckets create "gs://$bucket" --project="$project" --location="$region" --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets update "gs://$bucket" --update-labels=purpose=material-test03
 fi
 gcloud storage buckets describe "gs://$bucket" --format=json | node "$ops/config.cjs" bucket
 gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member="serviceAccount:$runtime_sa" --role=roles/storage.objectUser --condition=None >/dev/null
 # Share a pinned reference only; do not read/copy a secret into a new Secret or alter versions.
 gcloud secrets add-iam-policy-binding "$secret" --project="$project" --member="serviceAccount:$runtime_sa" --role=roles/secretmanager.secretAccessor --condition=None >/dev/null
 existing=$(gcloud artifacts repositories list --project="$project" --location="$region" --filter="name~/$repository$" --format='value(name)')
 if [[ -z "$existing" ]]; then gcloud artifacts repositories create "$repository" --project="$project" --location="$region" --repository-format=docker --description='Isolated TEST03 manual images'; fi
}
build() {
 git diff --quiet && git diff --cached --quiet || { echo 'コミット済みコードを使用してください'; exit 1; }
 revision=$(git rev-parse HEAD)
 image="$region-docker.pkg.dev/$project/$repository/phase4:$revision"
 mkdir "$scratch/context"
 git archive HEAD material-generation | tar -x -C "$scratch/context"
 gcloud builds submit "$scratch/context" --project="$project" --region="$region" --config=material-generation/ops/test01/cloudbuild.yaml --substitutions="_IMAGE=$image"
}
deploy() {
 revision=$(git rev-parse HEAD)
 image="$region-docker.pkg.dev/$project/$repository/phase4:$revision"
 digest=$(gcloud artifacts docker images describe "$image" --project="$project" --format='value(image_summary.digest)')
 [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
 node "$ops/config.cjs" config "$audience" > "$scratch/env.json"
 # Only new TEST03 is reachable publicly; app still verifies Google signature + teacher authorization.
 gcloud run deploy "$service" --project="$project" --region="$region" --image="${image%:*}@$digest" \
  --service-account="$runtime_sa" --env-vars-file="$scratch/env.json" --set-secrets="MG_GEMINI_API_KEY=$secret:$version" \
  --port=8080 --cpu=1 --memory=512Mi --min-instances=0 --max-instances=1 --concurrency=1 --timeout=180 \
  --cpu-throttling --allow-unauthenticated --labels=purpose=material-test03,mode=phase4 --quiet
}
verify() {
 gcloud run services describe "$service" --project="$project" --region="$region" --format=json > "$scratch/run.json"
 node "$ops/config.cjs" run "$audience" "$version" "${1:-false}" < "$scratch/run.json"
 url=$(node -e 'const fs=require("node:fs");console.log(JSON.parse(fs.readFileSync(process.argv[1])).status.url)' "$scratch/run.json")
 status=$(curl --silent --show-error --max-time 30 --output /dev/null --write-out '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' "$url/step")
 [[ "$status" == 401 ]] || { echo "未認証拒否が401ではありません: $status"; exit 1; }
}
case "$stage" in
 setup-deploy) confirmed; check; prepare; build; deploy; verify false ;;
 approve-generation)
  confirmed
  [[ "${MG_ONE_ATTEMPT_APPROVED:-}" == true ]] || { echo 'TEST03の1回だけの生成承認にMG_ONE_ATTEMPT_APPROVED=trueが必要です'; exit 1; }
  # Approval only. No /enqueue or /step request with credentials is made here.
  verify false
  gcloud run services update "$service" --project="$project" --region="$region" --update-env-vars=MG_GENERATION_APPROVED=true --quiet
  verify true
  ;;
 verify) verify "${MG_EXPECT_APPROVED:-false}" ;;
 logs)
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="yoshilab-material-test03" AND jsonPayload.component="material_gemini"' --project="$project" --freshness=7d --limit=30 --format='table(timestamp,resource.labels.revision_name,jsonPayload.profile,jsonPayload.thinkingLevel,jsonPayload.event,jsonPayload.httpStatus,jsonPayload.providerStatus,jsonPayload.finishReason,jsonPayload.elapsedMs,jsonPayload.headersElapsedMs,jsonPayload.timeoutMs,jsonPayload.maxOutputTokens,jsonPayload.thoughtsTokenCount,jsonPayload.totalTokenCount,jsonPayload.retryAttempted)'
  ;;
 export)
  job=${2:-}; [[ "$job" =~ ^JOB-[a-f0-9]{32}$ ]] || exit 1
  dest=$(mktemp -d "${TMPDIR:-/tmp}/yoshilab-test03-review.XXXXXX")
  gcloud storage cp "gs://$bucket/material-generation-test03/$job.json" "$dest/job.json" >/dev/null
  node material-generation/phase4/review.cjs "$dest/job.json" > "$dest/review.json"
  echo "私有ローカル評価資料: $dest/review.json （本文を含むため公開ログへ貼らない）"
  ;;
 *) echo "Usage: $0 {setup-deploy|approve-generation|verify|logs|export JOB-id}"; exit 2 ;;
esac
