#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME=${PROJECT_NAME:-worldcup-sweepstake}
WORKER_NAME=${WORKER_NAME:-worldcup-sweepstake-updater}
KV_NAME=${KV_NAME:-worldcup-sweepstake-site}

cat <<MSG
This helper creates the Cloudflare resources used by the free-tier deployment.
It prints the KV namespace IDs that must be copied into:
  - cloudflare/pages/wrangler.toml
  - cloudflare/worker/wrangler.toml

MSG

npx wrangler pages project create "$PROJECT_NAME" --production-branch main || true
npx wrangler kv namespace create "$KV_NAME" --config cloudflare/worker/wrangler.toml
npx wrangler kv namespace create "$KV_NAME" --preview --config cloudflare/worker/wrangler.toml

cat <<MSG

Next steps:
1. Copy the production and preview KV IDs printed above into both wrangler.toml files.
2. Run: npm run cf:deploy
3. Optional manual refresh: curl -X POST https://$WORKER_NAME.<your-subdomain>.workers.dev/refresh
MSG
