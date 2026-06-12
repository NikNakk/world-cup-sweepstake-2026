# World Cup 2026 Sweepstake Cloudflare site

This project builds a static Cloudflare Pages site showing World Cup 2026 fixtures, results, group tables and knockout rounds, with each team labelled with the person from the sweepstake photo.

It uses the free open-source `worldcup26.ir` API from [rezarahiminia/worldcup2026](https://github.com/rezarahiminia/worldcup2026). A full refresh fetches:

1. `https://worldcup26.ir/get/games`
2. `https://worldcup26.ir/get/groups`
3. `https://worldcup26.ir/get/teams`
4. `https://worldcup26.ir/get/stadiums`

No API key is required for read access.

## Cloudflare deployment model

This repository is designed for Cloudflare's free tier and includes a GitHub Actions workflow for production deployment:

- **GitHub Actions** deploys the Cloudflare Pages site and scheduled Worker on pushes to `main`.
- **Cloudflare Pages** hosts the static assets in `site/` and the Pages Function in `functions/[[path]].js`.
- **Cloudflare Workers Cron Triggers** run `cloudflare/worker/scheduled.js` every five minutes during Cloudflare's scheduled window.
- **Workers KV** stores the latest rendered `index.html`, source payload, and update status so the page can be refreshed without committing generated HTML or running CI.
- The Pages Function serves the KV-backed `index.html` for `/` and `/index.html`, then lets Cloudflare Pages serve CSS, JavaScript, and JSON assets normally.

Scheduled refreshes only rewrite the cached page when the API reports a live match, or when an unfinished match is inside its scheduled three-hour kickoff window. A manual `POST /refresh` endpoint on the Worker can force a refresh.

## Repository structure

```text
.github/workflows/deploy-cloudflare.yml  GitHub Actions production deployment workflow
cloudflare/lib/people-map.js          Sweepstake mapping exported for Cloudflare Workers
cloudflare/lib/worldcup-renderer.js   Worker-safe API client, update-window logic, and HTML renderer
cloudflare/pages/wrangler.toml        Cloudflare Pages config and KV binding placeholder
cloudflare/worker/scheduled.js        Scheduled Worker and manual refresh endpoints
cloudflare/worker/wrangler.toml       Worker config, cron trigger, and KV binding placeholder
data/people_teams.json                Source sweepstake team-to-person mapping
functions/[[path]].js                 Cloudflare Pages Function that serves the latest KV HTML
scripts/build-site.js                 Node static HTML build using the shared Cloudflare renderer
scripts/cloudflare-bootstrap.sh        Helper to create Pages and KV resources
scripts/deploy-cloudflare.sh           One-command install/build/deploy helper
scripts/update-people-map.js           Regenerates the Worker people-map export from JSON
site/assets/style.css                 Site styling
site/assets/site.js                   Small progressive enhancement script
```

## Quick start locally

```bash
npm install
npm run build
npx wrangler pages dev site --compatibility-date=2025-06-01
```

Then open the local URL printed by Wrangler, usually `http://localhost:8788`.

The build and live Cloudflare paths both use `cloudflare/lib/worldcup-renderer.js`, so API normalization and HTML rendering live in one JavaScript implementation. If the API cannot be reached during `npm run build`, the build script will use `.cache/last_payload.json` if one exists; otherwise it will still build the page with empty data. This makes local styling changes possible without needing a live API response.

## Cloudflare setup

### 1. Install Wrangler and log in

```bash
npm install
npx wrangler login
```

### 2. Create the free-tier Cloudflare resources

```bash
./scripts/cloudflare-bootstrap.sh
```

The bootstrap helper creates a Pages project and prints the production and preview Workers KV namespace IDs. Copy those IDs into both files:

- `cloudflare/pages/wrangler.toml`
- `cloudflare/worker/wrangler.toml`

Use the same production namespace ID for both configs so the scheduled Worker and Pages Function share the rendered page.

### 3. Deploy Pages and the scheduled Worker

Pushes to `main` deploy automatically through `.github/workflows/deploy-cloudflare.yml`. Configure these GitHub Actions repository secrets before relying on the workflow:

- `CLOUDFLARE_API_TOKEN` - a Cloudflare API token with permission to deploy the Pages project and Worker.
- `CLOUDFLARE_ACCOUNT_ID` - the Cloudflare account ID that owns the Pages project, Worker, and KV namespace.

You can also deploy manually from your machine:

```bash
npm run cf:deploy
```

Or deploy each part separately:

```bash
npm run cf:pages:deploy
npm run cf:worker:deploy
```

Production deploys use `npm run build:strict`, so the deploy fails rather than publishing an empty static fallback if the World Cup API is unavailable. Local `npm run build` still supports the cached/empty fallback for styling work.

### 4. Optional: protect manual refreshes

The cron trigger does not need a token. Manual `POST /refresh` calls are disabled unless you set an `UPDATE_TOKEN` secret on the Worker:

```bash
npx wrangler secret put UPDATE_TOKEN --config cloudflare/worker/wrangler.toml
```

Then trigger a forced refresh with:

```bash
curl -X POST \
  -H "Authorization: Bearer $UPDATE_TOKEN" \
  https://worldcup-sweepstake-updater.<your-workers-subdomain>.workers.dev/refresh
```

Without `UPDATE_TOKEN`, `POST /refresh` returns `503` so the refresh endpoint is not accidentally left open. You can inspect the latest public, non-sensitive status with:

```bash
curl https://worldcup-sweepstake-updater.<your-workers-subdomain>.workers.dev/health
```

### Security notes

- Keep `UPDATE_TOKEN` in Cloudflare Worker Secrets, not in `wrangler.toml` or source control. Local secret files such as `.dev.vars` and `.env` are ignored by Git.
- The Pages Function and static fallback include baseline browser security headers, including CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.
- If the updater Worker does not need a public manual refresh URL, consider setting `workers_dev = false` and using only the cron trigger, or protect any custom/manual route with Cloudflare Access.

## Changing the sweepstake mapping

Edit `data/people_teams.json`, then regenerate the Cloudflare export:

```bash
npm run sync:people-map
```

Several aliases are included because APIs may use names such as `Democratic Republic of the Congo` rather than `DR Congo`, or `Côte d'Ivoire` rather than `Ivory Coast`.

Current mapping transcribed from the image:

| Person | Teams |
|---|---|
| Jane | Uruguay, Japan, Qatar |
| Emma | France, Ivory Coast, Czech Republic |
| Jennie | Netherlands, Austria, Panama |
| Sean | Senegal, Iran, Jordan |
| Shyam | Portugal, Algeria, Haiti |
| Nick | Germany, Australia, DR Congo |
| Ben | England, Paraguay, Iraq |
| Tom | Egypt, Norway, Scotland |
| Tariq | Croatia, Canada, Uzbekistan |
| Chris | Spain, Ghana, Sweden |
| John C | Argentina, Turkey, New Zealand |
| Richard | South Korea, United States, Tunisia |
| Alistair | Morocco, Switzerland, Bosnia & Herzegovina |
| Andrew | Brazil, Mexico, Cape Verde |
| Diggers | Colombia, Saudi Arabia, South Africa |
| Extra | Belgium, Ecuador, Curacao |

## API refresh notes

Cloudflare runs the Worker cron every 5 minutes using `3-59/5 * * * *`. Scheduled runs only render and store a new page when the API reports a live match, or when an unfinished match is within its scheduled 3-hour kickoff window. Manual Worker refreshes always render and store a new page.
