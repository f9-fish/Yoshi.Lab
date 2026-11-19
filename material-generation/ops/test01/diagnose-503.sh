#!/usr/bin/env bash
# READ ONLY: no Gemini request, Secret access, writes, lock release or reset.
set -euo pipefail
set +x
cd "$(dirname "$0")/../../.."
project=yoshi-lab-db3eb
service=yoshilab-material-test01
region=asia-northeast1
base=gs://yoshi-lab-db3eb-material-test01-jobs/material-generation-test
summary=material-generation/phase4/diagnose-503.cjs
command -v gcloud >/dev/null || { echo 'Cloud Shellで実行してください'; exit 1; }
gcloud run services describe "$service" --project="$project" --region="$region" --format=json | node "$summary" run
gcloud storage cat "$base/JOB-b888236ffcfcd39446e41e5e09e4fd70.json" | node "$summary" job
gcloud storage cat "$base/PHASE4-TEST01.json" | node "$summary" claim
# No URL, IP, User-Agent, textPayload, auth headers or full JSON output.
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="yoshilab-material-test01" AND logName="projects/yoshi-lab-db3eb/logs/run.googleapis.com%2Frequests"' \
  --project="$project" --freshness=7d --limit=50 \
  --format='table(timestamp,resource.labels.revision_name,httpRequest.status,httpRequest.latency)'
# Only revisions with the diagnostic patch emit this component; old failures cannot be reconstructed.
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="yoshilab-material-test01" AND jsonPayload.component="material_gemini"' \
  --project="$project" --freshness=7d --limit=50 \
  --format='table(timestamp,resource.labels.revision_name,jsonPayload.event,jsonPayload.httpStatus,jsonPayload.providerStatus,jsonPayload.providerCode,jsonPayload.elapsedMs,jsonPayload.timeoutMs,jsonPayload.requestBytes,jsonPayload.sourceRows,jsonPayload.maxOutputTokens,jsonPayload.retryAfterSeconds,jsonPayload.retryAttempted)'
