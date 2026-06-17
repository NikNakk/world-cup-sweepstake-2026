# World Cup 2026 Sweepstake Cloudflare site

This project builds a static Cloudflare Pages site showing World Cup 2026 fixtures, results, group tables and knockout rounds, with each team labelled with the person from the sweepstake photo.

It uses the football-data.org World Cup matches endpoint. A full refresh makes one request to:

1. `https://api.football-data.org/v4/competitions/WC/matches`

Set `FOOTBALL_DATA_API_KEY` in local environments, GitHub Actions, the Cloudflare Pages project, and the updater Worker. The renderer sends that value as the football-data.org `X-Auth-Token` request header. The free football-data.org plan is limited to 10 requests per minute, so the app uses a single matches request per refresh and surfaces `429` responses with the server retry hint instead of retry-looping.

## Cloudflare deployment model

This repository is designed for Cloudflare's free tier and includes a GitHub Actions workflow for production deployment:

- **GitHub Actions** deploys the Cloudflare Pages site and updater Worker on pushes to `main`, then calls the deployed Worker refresh endpoint so the Worker run appears in Worker logs and rewrites the shared KV cache.
- **Cloudflare Pages** hosts the static assets in `site/` and the Pages Function in `functions/[[path]].js`.
- **Cloudflare Durable Objects alarms** run the updater every five minutes with a lightweight Cron Trigger only bootstrapping the singleton Durable Object scheduler.
- **Workers KV** stores the latest rendered `index.html`, source payload, and update status so the page can be refreshed without committing generated HTML or running CI.
- The Pages Function serves the KV-backed `index.html` for `/` and `/index.html`, then lets Cloudflare Pages serve CSS, JavaScript, and JSON assets normally.

Deployments call the freshly deployed Worker after both the Pages Function and updater Worker are deployed, forcing the Durable Object coordinator to fetch the latest API payload and rewrite Workers KV so renderer or mapping changes go live even when there are no match updates. Durable Object alarm refreshes only rewrite the cached page when the API reports a live match, or when an unfinished match is inside its scheduled three-hour kickoff window. A manual `POST /refresh` endpoint on the Worker can force the same refresh through the Durable Object coordinator.

## Repository structure

```text
.github/workflows/deploy-cloudflare.yml  GitHub Actions production deployment workflow
cloudflare/lib/people-map.js          Sweepstake mapping exported for Cloudflare Workers
cloudflare/lib/worldcup-renderer.js   Worker-safe API client, update-window logic, and HTML renderer
wrangler.toml                         Cloudflare Pages config and KV binding placeholder
cloudflare/worker/scheduled.js        Worker endpoints plus Durable Object scheduler/alarm coordinator
cloudflare/worker/wrangler.toml       Worker config, cron bootstrap, Durable Object, and KV bindings
data/people_teams.json                Source sweepstake team-to-person mapping
functions/[[path]].js                 Cloudflare Pages Function that serves the latest KV HTML
scripts/build-site.js                 Node static HTML build using the shared Cloudflare renderer
scripts/cloudflare-bootstrap.sh        Helper to create Pages and KV resources
scripts/deploy-cloudflare.sh           One-command install/build/deploy helper
scripts/publish-rendered-kv.sh         Publishes the latest deployment render into Workers KV
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

- `wrangler.toml`
- `cloudflare/worker/wrangler.toml`

Use the same production namespace ID for both configs so the scheduled Worker and Pages Function share the rendered page.

### 3. Deploy Pages and the updater Worker

Pushes to `main` deploy automatically through `.github/workflows/deploy-cloudflare.yml`. Cloudflare Pages reads its Wrangler configuration from the repository root `wrangler.toml`; Pages does not support passing a custom config path to `wrangler pages deploy`. Configure these GitHub Actions repository secrets before relying on the workflow:

- `CLOUDFLARE_API_TOKEN` - a Cloudflare API token with permission to deploy the Pages project and Worker.
- `CLOUDFLARE_ACCOUNT_ID` - the Cloudflare account ID that owns the Pages project, Worker, and KV namespace.
- `WORKER_REFRESH_TOKEN` - a GitHub Actions secret whose value matches the Cloudflare Worker `UPDATE_TOKEN` secret.
- `WORKER_REFRESH_URL` - a GitHub Actions repository variable containing the Worker origin, for example `https://worldcup-sweepstake-updater.<your-workers-subdomain>.workers.dev`.
- `FOOTBALL_DATA_API_KEY` - a GitHub Actions secret containing the football-data.org API token used by `npm run build:strict`. The workflow also syncs this value into the updater Worker as a Cloudflare Worker secret before deploying it.

You can also deploy manually from your machine:

```bash
npm run cf:deploy
```

Or deploy each part separately:

```bash
npm run cf:pages:deploy
npm run cf:worker:deploy
```

Production deploys use `npm run build:strict`, so the deploy fails rather than publishing an empty static fallback if the World Cup API is unavailable or `FOOTBALL_DATA_API_KEY` is missing. The production workflow then sends an authenticated `POST /refresh` request to the deployed Worker after the Cloudflare Pages and updater Worker deploys complete. The Worker forwards that request to the Durable Object coordinator so deployment refresh CPU is spent in the Durable Object rather than the front Worker invocation. This makes every deployment produce an explicit Worker invocation in the logs and refresh the page render even if the scheduled updater would otherwise skip work because no matches are live or inside the update window. Local `npm run build` still supports the cached/empty fallback for styling work.

### 4. Optional: protect manual refreshes

The cron bootstrap and Durable Object alarm do not need a token. Manual `POST /refresh` calls and scheduler management calls are disabled unless you set an `UPDATE_TOKEN` secret on the Worker:

```bash
npx wrangler secret put UPDATE_TOKEN --config cloudflare/worker/wrangler.toml
```

Then trigger a forced refresh with:

```bash
curl -X POST \
  -H "Authorization: Bearer $UPDATE_TOKEN" \
  https://worldcup-sweepstake-updater.<your-workers-subdomain>.workers.dev/refresh
```

Without `UPDATE_TOKEN`, `POST /refresh`, `POST /scheduler/start`, and `POST /scheduler/stop` return `503` so refresh and scheduler management endpoints are not accidentally left open. You can inspect the latest public, non-sensitive status with:

```bash
curl https://worldcup-sweepstake-updater.<your-workers-subdomain>.workers.dev/health
```

You can also inspect only the Durable Object scheduler state:

```bash
curl https://worldcup-sweepstake-updater.<your-workers-subdomain>.workers.dev/scheduler/status
```

If the alarm ever needs to be re-seeded manually, call the protected scheduler start endpoint:

```bash
curl -X POST \
  -H "Authorization: Bearer $UPDATE_TOKEN" \
  https://worldcup-sweepstake-updater.<your-workers-subdomain>.workers.dev/scheduler/start
```

### Security notes

- Keep `UPDATE_TOKEN` and `FOOTBALL_DATA_API_KEY` in Cloudflare/GitHub secrets, not in `wrangler.toml` or source control. Local secret files such as `.dev.vars` and `.env` are ignored by Git.
- The Pages Function and static fallback include baseline browser security headers, including CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.
- If the updater Worker does not need public manual refresh or scheduler management URLs, consider setting `workers_dev = false`, or protect any custom/manual route with Cloudflare Access.

## Changing the sweepstake mapping

Edit `data/people_teams.json`, then regenerate the Cloudflare export:

```bash
npm run sync:people-map
```

The team names in `data/people_teams.json` should match the names returned by football-data.org. Keep the mapping canonical rather than adding aliases for alternate spellings.

Current mapping transcribed from the image:

| Person | Teams |
|---|---|
| Jane | Uruguay, Japan, Qatar |
| Emma | France, Ivory Coast, Czechia |
| Jennie | Netherlands, Austria, Panama |
| Sean | Senegal, Iran, Jordan |
| Shyam | Portugal, Algeria, Haiti |
| Nick | Germany, Australia, Congo DR |
| Ben | England, Paraguay, Iraq |
| Tom | Egypt, Norway, Scotland |
| Tariq | Croatia, Canada, Uzbekistan |
| Chris | Spain, Ghana, Sweden |
| John C | Argentina, Turkey, New Zealand |
| Richard | South Korea, United States, Tunisia |
| Alistair | Morocco, Switzerland, Bosnia-Herzegovina |
| Andrew | Brazil, Mexico, Cape Verde Islands |
| Diggers | Colombia, Saudi Arabia, South Africa |
| Extra | Belgium, Ecuador, Curaçao |

## API refresh notes

Cloudflare runs a lightweight Worker cron every 5 minutes using `3-59/5 * * * *` to bootstrap the singleton Durable Object if its alarm is missing or the last Durable Object refresh is stale. The Durable Object alarm performs the actual scheduled refresh every 5 minutes, avoiding the tight CPU budget of the front Worker invocation, and the bootstrap cron now also asks the Durable Object to run when there is no recorded run or the last run is more than 10 minutes old. Scheduled runs only render and store a new page when the API reports a live match, or when an unfinished match is within its scheduled 3-hour kickoff window. Manual Worker refreshes are forwarded to the Durable Object and always render and store a new page.

Deployments are the other forced-render path: `npm run build:strict` writes `site/index.html`, `site/payload.json`, and `site/last-update.json`, then the GitHub Actions workflow and `npm run cf:deploy` publish those files into the shared Workers KV namespace.
