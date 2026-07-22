#!/usr/bin/env bash
# Post-deploy health check. Run after `wrangler deploy` to confirm the
# promoted Worker is actually serving traffic before considering a deploy
# done. See README.md "Deploy" section for the rollback path if this fails.
set -euo pipefail

: "${STREAM_KEEPR_DEPLOY_HEALTH_URL:?Set STREAM_KEEPR_DEPLOY_HEALTH_URL to the deployed Worker base URL, e.g. https://stream-keepr.example.workers.dev, before running deploy:verify.}"

url="${STREAM_KEEPR_DEPLOY_HEALTH_URL%/}/api/time"

curl --fail --silent --show-error --max-time 15 \
	--retry 3 --retry-all-errors --retry-delay 5 \
	"$url" > /dev/null

echo "deploy:verify: $url responded OK"
