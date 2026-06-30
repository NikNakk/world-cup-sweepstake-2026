#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SITE_DIR = join(ROOT, 'site');
const ASSETS_DIR = join(SITE_DIR, 'assets');
const DATA_DIR = join(ROOT, 'data');
const CACHE_DIR = join(ROOT, '.cache');
const CACHE_FILE = join(CACHE_DIR, 'last_payload.json');

function normalizeCachedPayload(data) {
  return {
    fixtures: data.fixtures ?? [],
    standings: data.standings ?? [],
    rounds: data.rounds ?? [],
    generatedAt: data.generatedAt ?? data.generated_at ?? new Date().toISOString(),
    source: data.source === 'football-data.org' ? 'cached-football-data.org' : (data.source ?? 'cached-football-data.org'),
  };
}

async function loadCachedPayload() {
  const data = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  return normalizeCachedPayload(data);
}

async function getFallbackPayload() {
  try {
    return await loadCachedPayload();
  } catch (error) {
    console.warn(`No cached payload was available for the static fallback: ${error.message}`);
    return {
      fixtures: [],
      standings: [],
      rounds: [],
      generatedAt: new Date().toISOString(),
      source: 'static shell',
    };
  }
}

function apiConfig() {
  const explicitUrl = process.env.WORLDCUP_API_STATE_URL;
  const workerUrl = process.env.WORKER_REFRESH_URL;
  const apiUrl = explicitUrl ?? (workerUrl ? `${workerUrl.replace(/\/+$/, '')}/api/state` : '');
  return {
    stateUrl: apiUrl || '/api/state',
  };
}

function renderShell() {
  return `<!doctype html>
<html lang='en'>
<head>
  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1'>
  <title>World Cup 2026 Sweepstake</title>
  <link rel='icon' href='favicon.ico' sizes='any'>
  <link rel='icon' href='assets/gastro-world-cup.png' type='image/png'>
  <link rel='stylesheet' href='assets/style.css'>
</head>
<body>
  <header class='hero'>
    <div class='brand-lockup'>
      <img class='brand-mark' src='assets/gastro-world-cup.png' alt='' width='112' height='112'>
      <div>
        <p class='eyebrow'>World Cup 2026 wall chart</p>
        <h1>RDUH Gastro Sweepstake</h1>
        <p class='lead' data-load-status>Loading live sweepstake data...</p>
      </div>
    </div>
  </header>
  <main>
    <section>
      <div class='section-heading'><h2>Loading</h2><p>The latest fixtures and standings are coming from the sweepstake API.</p></div>
    </section>
  </main>
  <script type='module' src='assets/site.js'></script>
</body>
</html>`;
}

async function build() {
  const payload = await getFallbackPayload();

  await mkdir(ASSETS_DIR, { recursive: true });
  await writeFile(join(SITE_DIR, 'index.html'), renderShell(), 'utf8');
  await writeFile(join(SITE_DIR, 'api-config.json'), `${JSON.stringify(apiConfig(), null, 2)}\n`, 'utf8');
  await writeFile(join(SITE_DIR, 'payload.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await writeFile(join(SITE_DIR, 'last-update.json'), `${JSON.stringify({
    updated: false,
    reason: 'Static fallback written during deployment build. Live data is served from /api/state.',
    checkedAt: new Date().toISOString(),
    generatedAt: payload.generatedAt,
    fixtures: payload.fixtures.length,
    source: payload.source,
  }, null, 2)}\n`, 'utf8');
  await copyFile(join(DATA_DIR, 'people_teams.json'), join(SITE_DIR, 'people_teams.json'));
  await copyFile(join(ROOT, 'src/worldcup-renderer.js'), join(ASSETS_DIR, 'worldcup-renderer.js'));
  await copyFile(join(ROOT, 'cloudflare/lib/people-map.js'), join(ASSETS_DIR, 'people-map.js'));

  console.log('Built static site shell. Live data is loaded from /api/state.');
}

await build();
