#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PEOPLE_MAP } from '../cloudflare/lib/people-map.js';
import { fetchApiPayload, renderPage } from '../cloudflare/lib/worldcup-renderer.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SITE_DIR = join(ROOT, 'site');
const ASSETS_DIR = join(SITE_DIR, 'assets');
const DATA_DIR = join(ROOT, 'data');
const CACHE_DIR = join(ROOT, '.cache');
const CACHE_FILE = join(CACHE_DIR, 'last_payload.json');

function emptyPayload() {
  return {
    fixtures: [],
    standings: [],
    rounds: [],
    generatedAt: new Date().toISOString(),
    source: 'football-data.org unavailable / no cache',
  };
}

function normalizeCachedPayload(data) {
  return {
    fixtures: data.fixtures ?? [],
    standings: data.standings ?? [],
    rounds: data.rounds ?? [],
    generatedAt: data.generatedAt ?? data.generated_at ?? new Date().toISOString(),
    source: data.source === 'football-data.org' ? 'cached-football-data.org' : (data.source ?? 'cached-football-data.org'),
  };
}

async function cachePayload(payload) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function loadCachedPayload() {
  const data = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  return normalizeCachedPayload(data);
}

async function getPayload({ allowCache }) {
  try {
    const payload = await fetchApiPayload({ apiKey: process.env.FOOTBALL_DATA_API_KEY });
    await cachePayload(payload);
    return payload;
  } catch (error) {
    if (!allowCache) {
      throw error;
    }

    try {
      return await loadCachedPayload();
    } catch (_cacheError) {
      console.warn(`football-data.org fetch failed and no cache was available: ${error.message}`);
      return emptyPayload();
    }
  }
}

async function build() {
  const allowCache = !process.argv.includes('--no-cache');
  const payload = await getPayload({ allowCache });
  const html = renderPage(payload, PEOPLE_MAP);

  await mkdir(ASSETS_DIR, { recursive: true });
  await writeFile(join(SITE_DIR, 'index.html'), html, 'utf8');
  await writeFile(join(SITE_DIR, 'payload.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await writeFile(join(SITE_DIR, 'last-update.json'), `${JSON.stringify({
    updated: true,
    reason: 'Rendered during deployment build.',
    checkedAt: new Date().toISOString(),
    generatedAt: payload.generatedAt,
    fixtures: payload.fixtures.length,
    source: payload.source,
  }, null, 2)}\n`, 'utf8');
  await copyFile(join(DATA_DIR, 'people_teams.json'), join(SITE_DIR, 'people_teams.json'));

  console.log(`Built site/index.html with ${payload.fixtures.length} fixtures from ${payload.source}.`);
}

await build();
