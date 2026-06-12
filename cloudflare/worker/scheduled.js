import { PEOPLE_MAP } from '../lib/people-map.js';
import { CACHE_KEYS, refreshSite } from '../lib/worldcup-renderer.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers ?? {}),
    },
  });
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

async function isAuthorized(request, env) {
  if (!env.UPDATE_TOKEN) return false;
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  return equalBytes(await sha256(token), await sha256(env.UPDATE_TOKEN));
}

export default {
  async scheduled(event, env, ctx) {
    const startedAt = new Date().toISOString();
    console.log('Scheduled refresh started.', {
      cron: event.cron,
      scheduledTime: new Date(event.scheduledTime).toISOString(),
      startedAt,
    });

    ctx.waitUntil((async () => {
      try {
        const status = await refreshSite(env.WORLDCUP_SITE, PEOPLE_MAP);
        console.log('Scheduled refresh finished.', status);
      } catch (error) {
        console.error('Scheduled refresh failed.', {
          message: error?.message ?? String(error),
          stack: error?.stack,
        });
        throw error;
      }
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      const status = await env.WORLDCUP_SITE.get(CACHE_KEYS.status, 'json');
      return jsonResponse(status ?? { updated: false, reason: 'No scheduled refresh has run yet.' });
    }

    if (url.pathname === '/refresh') {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'Use POST /refresh to trigger a manual refresh.' }, { status: 405 });
      }
      if (!env.UPDATE_TOKEN) {
        return jsonResponse({ error: 'Manual refresh is disabled until UPDATE_TOKEN is configured.' }, { status: 503 });
      }
      if (!(await isAuthorized(request, env))) {
        return jsonResponse({ error: 'Unauthorized.' }, { status: 401 });
      }
      console.log('Manual refresh requested.', { path: url.pathname });
      const status = await refreshSite(env.WORLDCUP_SITE, PEOPLE_MAP, { force: true });
      console.log('Manual refresh finished.', status);
      return jsonResponse(status);
    }

    return jsonResponse({
      service: 'worldcup-sweepstake-updater',
      endpoints: ['/health', 'POST /refresh'],
    });
  },
};
