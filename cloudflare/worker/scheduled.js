import { PEOPLE_MAP } from '../lib/people-map.js';
import { CACHE_KEYS, refreshSite } from '../lib/worldcup-renderer.js';

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {}),
    },
  });
}

function isAuthorized(request, env) {
  if (!env.UPDATE_TOKEN) return true;
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  return token === env.UPDATE_TOKEN;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refreshSite(env.WORLDCUP_SITE, PEOPLE_MAP));
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
      if (!isAuthorized(request, env)) {
        return jsonResponse({ error: 'Unauthorized.' }, { status: 401 });
      }
      const status = await refreshSite(env.WORLDCUP_SITE, PEOPLE_MAP, { force: true });
      return jsonResponse(status);
    }

    return jsonResponse({
      service: 'worldcup-sweepstake-updater',
      endpoints: ['/health', 'POST /refresh'],
    });
  },
};
