#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${1:-$ROOT/wrangler.toml}"

if [[ ! -f "$CONFIG" ]]; then
  echo "Wrangler config not found: $CONFIG" >&2
  exit 1
fi

KV_NAMESPACE_ID="$(node -e "const fs=require('fs'); const text=fs.readFileSync(process.argv[1],'utf8'); const match=text.match(/\[\[kv_namespaces\]\][\s\S]*?\bid\s*=\s*\"([^\"]+)\"/); if (!match) process.exit(1); process.stdout.write(match[1]);" "$CONFIG")"

publish_key() {
  local key="$1"
  local file="$2"
  if [[ ! -f "$file" ]]; then
    echo "Rendered file not found: $file" >&2
    exit 1
  fi
  npx wrangler kv key put "$key" --path "$file" --namespace-id "$KV_NAMESPACE_ID"
}

publish_key 'site:index.html' "$ROOT/site/index.html"
publish_key 'site:payload.json' "$ROOT/site/payload.json"
publish_key 'site:last-update.json' "$ROOT/site/last-update.json"

printf 'Published rendered site to KV namespace %s.\n' "$KV_NAMESPACE_ID"
