#!/usr/bin/env bash
# This incident only: read Cloud Run/GCS/Logs. No Secret/model access, generation or mutation.
set -euo pipefail
set +x
umask 077
cd "$(dirname "$0")/../../.."
command -v gcloud >/dev/null || { echo 'Cloud Shellで実行してください'; exit 1; }
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
summary=material-generation/ops/test03/incident-summary.cjs
failures=0
read_section() {
 local section=$1
 shift
 if "$@" > "$scratch/$section.json" 2> "$scratch/$section.stderr"; then
  if ! node "$summary" "$section" < "$scratch/$section.json"; then
   printf '{"section":"%s","readStatus":"SUMMARY_FAILED"}\n' "$section"
   failures=$((failures+1))
  fi
 else
  # gcloud stderr may contain account identities. Keep it private; never print it wholesale.
  printf '{"section":"%s","readStatus":"READ_FAILED"}\n' "$section"
  failures=$((failures+1))
 fi
}
read_section run gcloud run services describe yoshilab-material-test03 --project=yoshi-lab-db3eb --region=asia-northeast1 --format=json
read_section job gcloud storage cat gs://yoshi-lab-db3eb-material-test03-jobs/material-generation-test03/JOB-dcb7e4afbc33a3565fb44a022b5cdcb2.json
read_section claim gcloud storage cat gs://yoshi-lab-db3eb-material-test03-jobs/material-generation-test03/PHASE4-TEST03.json
# JST Nov 12 23:17–23:18 == UTC 14:17–14:18. Include margin; no relative freshness dependency.
base='resource.type="cloud_run_revision" AND resource.labels.service_name="yoshilab-material-test03" AND timestamp>="2026-11-12T14:10:00Z" AND timestamp<="2026-11-12T14:25:00Z"'
read_section gemini-logs gcloud logging read "$base AND jsonPayload.component=\"material_gemini\"" --project=yoshi-lab-db3eb --limit=100 --order=asc --format=json
read_section validation-logs gcloud logging read "$base AND jsonPayload.component=\"material_validation\"" --project=yoshi-lab-db3eb --limit=100 --order=asc --format=json
read_section request-logs gcloud logging read "$base AND logName=\"projects/yoshi-lab-db3eb/logs/run.googleapis.com%2Frequests\"" --project=yoshi-lab-db3eb --limit=100 --order=asc --format=json
printf '{"readFailures":%s,"generationRequested":false,"cloudChanges":false}\n' "$failures"
[[ "$failures" == 0 ]]
