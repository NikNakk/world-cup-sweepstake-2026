import { PEOPLE_MAP } from '../cloudflare/lib/people-map.js';
import { CACHE_KEYS, fetchApiPayload, renderPage } from '../cloudflare/lib/worldcup-renderer.js';

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=30',
  ...SECURITY_HEADERS,
};

function wantsIndex(pathname) {
  return pathname === '/' || pathname === '/index.html';
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!wantsIndex(url.pathname)) {
    return env.ASSETS.fetch(request);
  }

  const cachedHtml = await env.WORLDCUP_SITE.get(CACHE_KEYS.html);
  if (cachedHtml) {
    return new Response(cachedHtml, { headers: HTML_HEADERS });
  }

  try {
    const payload = await fetchApiPayload();
    const html = renderPage(payload, PEOPLE_MAP);
    await Promise.all([
      env.WORLDCUP_SITE.put(CACHE_KEYS.html, html),
      env.WORLDCUP_SITE.put(CACHE_KEYS.payload, JSON.stringify(payload, null, 2)),
    ]);
    return new Response(html, { headers: HTML_HEADERS });
  } catch (_error) {
    return env.ASSETS.fetch(request);
  }
}
