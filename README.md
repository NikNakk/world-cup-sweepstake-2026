# World Cup 2026 Sweepstake Cloudflare site

This project builds a static Cloudflare Pages site showing World Cup 2026 fixtures, results, group tables and knockout rounds, with each team labelled with the person from the sweepstake photo.

It uses the football-data.org World Cup matches endpoint. A full refresh makes one request to:

1. `https://api.football-data.org/v4/competitions/WC/matches`

Set `FOOTBALL_DATA_API_KEY` in GitHub Actions and the updater Worker. The Worker sends that value as the football-data.org `X-Auth-Token` request header, then stores the normalized response in SQLite-backed Durable Object storage. The free football-data.org plan is limited to 10 requests per minute, so the app uses a single matches request per refresh and surfaces `429` responses with the server retry hint instead of retry-looping.

## Cloudflare deployment model

This repository is designed for Cloudflare's free tier and includes a GitHub Actions workflow for production deployment:

- **GitHub Actions** deploys the Cloudflare Pages site and updater Worker on pushes to `main`, then calls the deployed Worker refresh endpoint so the Worker run appears in Worker logs and refreshes the SQLite cache.
- **Cloudflare Pages** hosts the static frontend assets in `site/`.
- **Cloudflare Durable Objects alarms** run the updater on a dynamic cadence with a lightweight Cron Trigger bootstrapping the singleton Durable Object scheduler.
- **SQLite-backed Durable Object storage** stores the latest normalized payload and update status.
- The browser loads the static shell from Pages, calls `/api/state`, renders the wall chart from the cached JSON, and polls the backend every minute while open without exposing the football-data.org API key.

Deployments call the freshly deployed Worker after both Pages and the updater Worker are deployed, forcing the Durable Object coordinator to fetch the latest API payload and write the SQLite cache so renderer or mapping changes go live even when there are no match updates. Durable Object alarm refreshes only rewrite the cached payload when the API reports a live match, or when an unfinished match is inside its scheduled three-hour kickoff window. A manual `POST /refresh` endpoint on the Worker can force the same refresh through the Durable Object coordinator.

## Repository structure

```text
.github/workflows/deploy-cloudflare.yml  GitHub Actions production deployment workflow
cloudflare/lib/people-map.js          Sweepstake mapping exported for Cloudflare Workers
cloudflare/lib/worldcup-renderer.js   Worker-safe API client, update-window logic, and HTML renderer
wrangler.toml                         Cloudflare Pages config
cloudflare/worker/scheduled.js        Worker endpoints plus Durable Object scheduler/alarm coordinator
cloudflare/worker/wrangler.toml       Worker config, cron bootstrap, and Durable Object binding
data/people_teams.json                Source sweepstake team-to-person mapping
scripts/build-site.js                 Node static HTML build using the shared Cloudflare renderer
scripts/cloudflare-bootstrap.sh        Helper to create the Pages project
scripts/deploy-cloudflare.sh           One-command install/build/deploy helper
scripts/update-people-map.js           Regenerates the Worker people-map export from JSON
site/assets/style.css                 Site styling
site/assets/site.js                   Static frontend renderer and filtering script
```

## Quick start locally

```bash
npm install
npm run build
npx wrangler pages dev site --compatibility-date=2025-06-01
```

Then open the local URL printed by Wrangler, usually `http://localhost:8788`.

The build and live Cloudflare paths both use `cloudflare/lib/worldcup-renderer.js`, so API normalization and HTML rendering live in one JavaScript implementation. `npm run build` creates a static shell and copies the shared browser renderer into `site/assets`; live data is loaded from `/api/state` at runtime.

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

The bootstrap helper creates the Pages project. The updater Worker creates its SQLite-backed Durable Object namespace from `cloudflare/worker/wrangler.toml` during deploy.

### 3. Deploy Pages and the updater Worker

Pushes to `main` deploy automatically through `.github/workflows/deploy-cloudflare.yml`. Cloudflare Pages reads its Wrangler configuration from the repository root `wrangler.toml`; Pages does not support passing a custom config path to `wrangler pages deploy`. Configure these GitHub Actions repository secrets before relying on the workflow:

- `CLOUDFLARE_API_TOKEN` - a Cloudflare API token with permission to deploy the Pages project and Worker.
- `CLOUDFLARE_ACCOUNT_ID` - the Cloudflare account ID that owns the Pages project and Worker.
- `WORKER_REFRESH_TOKEN` - a GitHub Actions secret whose value matches the Cloudflare Worker `UPDATE_TOKEN` secret.
- `WORKER_REFRESH_URL` - a GitHub Actions repository variable containing the Worker origin, for example `https://worldcup-sweepstake-updater.<your-workers-subdomain>.workers.dev`.
- `FOOTBALL_DATA_API_KEY` - a GitHub Actions secret containing the football-data.org API token. The workflow syncs this value into the updater Worker as a Cloudflare Worker secret before deploying it.

You can also deploy manually from your machine:

```bash
npm run cf:deploy
```

Or deploy each part separately:

```bash
npm run cf:pages:deploy
npm run cf:worker:deploy
```

Production deploys use `npm run build:strict` to publish a static shell. The production workflow then sends an authenticated `POST /refresh` request to the deployed Worker after the Cloudflare Pages and updater Worker deploys complete. The Worker forwards that request to the Durable Object coordinator so deployment refresh CPU is spent in the Durable Object rather than the front Worker invocation. This makes every deployment produce an explicit Worker invocation in the logs and refresh the SQLite-backed payload even if the scheduled updater would otherwise skip work because no matches are live or inside the update window.

Route `/api/*` on the production hostname to the updater Worker so the static frontend can load `/api/state` from the same origin. If you serve the Worker from a separate hostname, set `window.WORLDCUP_API_STATE_URL` in the static shell before `assets/site.js` loads.

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
- The static frontend does not contain the football-data.org API key; only the updater Worker calls the upstream API.
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

Cloudflare runs a lightweight Worker cron every minute using `* * * * *` to bootstrap the singleton Durable Object if its alarm is missing or overdue. The Durable Object alarm performs the actual scheduled refresh, avoiding the tight CPU budget of the front Worker invocation. After each run it schedules the next alarm for:

- 1 minute when any match is live.
- 5 minutes during the 17:00-08:00 Europe/London match window when no match is live.
- 1 hour outside that window, capped so the scheduler wakes at the next 17:00 window start.

Scheduled runs only render and store a new payload when the API reports a live match, or when an unfinished match is within its scheduled 3-hour kickoff window. Manual Worker refreshes are forwarded to the Durable Object and always render and store a new payload.

Deployments are the other forced-refresh path: `npm run build:strict` writes the static shell, then the GitHub Actions workflow calls the deployed Worker refresh endpoint to store the latest payload and status in SQLite-backed Durable Object storage.
