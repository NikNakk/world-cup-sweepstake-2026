#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME=${PROJECT_NAME:-worldcup-sweepstake}
WORKER_NAME=${WORKER_NAME:-worldcup-sweepstake-updater}

cat <<MSG
This helper creates the Cloudflare resources used by the free-tier deployment.
The updater Worker uses SQLite-backed Durable Object storage for cached data.

MSG

npx wrangler pages project create "$PROJECT_NAME" --production-branch main || true

cat <<MSG

Next steps:
1. Run: npm run cf:deploy
2. Route /api/* on your production hostname to the $WORKER_NAME Worker, or set window.WORLDCUP_API_STATE_URL in the static shell.
3. Optional manual refresh: curl -X POST https://$WORKER_NAME.<your-subdomain>.workers.dev/refresh
MSG
