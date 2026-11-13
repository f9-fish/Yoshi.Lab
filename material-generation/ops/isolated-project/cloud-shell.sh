#!/usr/bin/env bash
# No tracing, project creation, billing changes, or automatic Gemini requests.
set +x
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mode=${1:-plan}
case "$mode" in
  plan|setup|check)
    exec python3 -B "$script_dir/provision.py" "$@"
    ;;
  verify-model|generate-ten)
    project=${2:-}
    if [[ ! "$project" =~ ^yoshilab-material-ai-[a-z0-9]{4,9}$ ]] || [[ $# != 2 ]]; then
      echo 'INVALID_DEDICATED_PROJECT' >&2; exit 1
    fi
    if [[ ${MG_ISOLATED_APPROVED:-} != "$mode" || ${MG_COST_CONFIRMED:-} != true ]]; then
      echo 'EXPLICIT_APPROVAL_REQUIRED' >&2; exit 1
    fi
    node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
    # Installed only after stage approval. No Cloud/Gemini calls in npm lifecycle scripts.
    if [[ ! -d "$script_dir/../../node_modules/@google-cloud/storage" ]]; then
      npm ci --prefix "$script_dir/../.." --ignore-scripts --no-audit --no-fund
    fi
    exec node "$script_dir/runner.cjs" "$mode" "$HOME/.config/yoshilab-material/$project/config.json"
    ;;
  *) echo 'INVALID_STAGE' >&2; exit 1 ;;
esac
