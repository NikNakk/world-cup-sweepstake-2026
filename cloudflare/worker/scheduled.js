import { PEOPLE_MAP } from '../lib/people-map.js';
import { CACHE_KEYS, refreshSite } from '../lib/worldcup-renderer.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept',
};

const SCHEDULER_OBJECT_NAME = 'worldcup-sweepstake-updater';
const LIVE_INTERVAL_MS = 60 * 1000;
const MATCH_WINDOW_INTERVAL_MS = 5 * 60 * 1000;
const QUIET_INTERVAL_MS = 60 * 60 * 1000;
const ALARM_OVERDUE_GRACE_MS = 2 * 60 * 1000;
const INTERNAL_SCHEDULER_URL = 'https://scheduler.internal/';

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers ?? {}),
    },
  });
}

function parseJsonRequest(request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return Promise.resolve({});
  return request.json().catch(() => ({}));
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

function schedulerStub(env) {
  const id = env.UPDATER_COORDINATOR.idFromName(SCHEDULER_OBJECT_NAME);
  return env.UPDATER_COORDINATOR.get(id);
}

async function callScheduler(env, path, init = {}) {
  const response = await schedulerStub(env).fetch(new Request(new URL(path, INTERNAL_SCHEDULER_URL), init));
  return response.json();
}

function ukClockMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function isMatchWindow(date = new Date()) {
  const minutes = ukClockMinutes(date);
  return minutes >= 17 * 60 || minutes < 8 * 60;
}

function msUntilNextMatchWindow(date = new Date()) {
  const minutes = ukClockMinutes(date);
  if (minutes >= 17 * 60 || minutes < 8 * 60) return 0;
  const minutesUntilWindow = (17 * 60) - minutes;
  const seconds = date.getSeconds();
  const milliseconds = date.getMilliseconds();
  return (minutesUntilWindow * 60 * 1000) - (seconds * 1000) - milliseconds;
}

function refreshIntervalMs(status, from = new Date()) {
  if ((status?.gameSummary?.live ?? 0) > 0) return LIVE_INTERVAL_MS;
  if (isMatchWindow(from)) return MATCH_WINDOW_INTERVAL_MS;
  return Math.min(QUIET_INTERVAL_MS, msUntilNextMatchWindow(from));
}

function nextAlarmTime(intervalMs, from = Date.now()) {
  return from + intervalMs;
}

function serializeError(error) {
  return {
    message: error?.message ?? String(error),
    stack: error?.stack,
  };
}

function sqliteSiteCache(storage) {
  return {
    getPayload() {
      return storage.get(CACHE_KEYS.payload);
    },
    putStatus(status) {
      return storage.put(CACHE_KEYS.status, status);
    },
    putRenderedSite({ payload, status }) {
      return storage.put({
        [CACHE_KEYS.payload]: payload,
        [CACHE_KEYS.status]: status,
      });
    },
  };
}

export class UpdaterCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/run') {
      const body = await parseJsonRequest(request);
      const status = await this.runUpdate({ force: Boolean(body.force), trigger: body.trigger ?? 'manual' });
      return jsonResponse(status);
    }

    if (url.pathname === '/payload') {
      const payload = await this.state.storage.get(CACHE_KEYS.payload);
      if (!payload) {
        return jsonResponse({ error: 'No payload has been generated yet.' }, { status: 404 });
      }
      return jsonResponse(payload, {
        headers: {
          'cache-control': 'public, max-age=15',
        },
      });
    }

    if (url.pathname === '/site-status') {
      const status = await this.state.storage.get(CACHE_KEYS.status);
      return jsonResponse(status ?? { updated: false, reason: 'No scheduled refresh has run yet.' });
    }

    if (url.pathname === '/state') {
      const [payload, status] = await Promise.all([
        this.state.storage.get(CACHE_KEYS.payload),
        this.state.storage.get(CACHE_KEYS.status),
      ]);
      if (!payload) {
        return jsonResponse({ error: 'No payload has been generated yet.' }, { status: 404 });
      }
      return jsonResponse({
        payload,
        status: status ?? { updated: false, reason: 'No scheduled refresh has run yet.' },
      }, {
        headers: {
          'cache-control': 'public, max-age=15',
        },
      });
    }

    if (url.pathname === '/start') {
      const status = await this.scheduleNext();
      return jsonResponse(status);
    }

    if (url.pathname === '/bootstrap') {
      const status = await this.bootstrap();
      return jsonResponse(status);
    }

    if (url.pathname === '/stop') {
      await this.state.storage.deleteAlarm();
      await this.putScheduler({ enabled: false, stoppedAt: new Date().toISOString() });
      const status = await this.schedulerStatus();
      return jsonResponse({ ...status, stopped: true });
    }

    if (url.pathname === '/status') {
      return jsonResponse(await this.schedulerStatus());
    }

    return jsonResponse({ error: 'Unknown scheduler endpoint.' }, { status: 404 });
  }

  async alarm() {
    let status;
    try {
      status = await this.runUpdate({ trigger: 'alarm' });
    } finally {
      await this.scheduleNext({ intervalMs: refreshIntervalMs(status) });
    }
  }

  async bootstrap() {
    await this.putScheduler({ lastBootstrapAt: new Date().toISOString() });
    const alarmBeforeBootstrap = await this.state.storage.getAlarm();
    const schedulerStatus = await this.scheduleNext({ onlyIfMissing: true });
    if (alarmBeforeBootstrap && !this.shouldBootstrapRun(schedulerStatus)) {
      return { ...schedulerStatus, bootstrappedRun: false };
    }

    const runStatus = await this.runUpdate({ trigger: 'bootstrap' });
    await this.scheduleNext({ intervalMs: refreshIntervalMs(runStatus) });
    return {
      ...(await this.schedulerStatus()),
      bootstrappedRun: true,
      run: runStatus,
    };
  }

  shouldBootstrapRun(status) {
    if (!status.nextAlarmAt) return true;
    const nextAlarmTime = Date.parse(status.nextAlarmAt);
    if (Number.isNaN(nextAlarmTime)) return true;
    return Date.now() - nextAlarmTime > ALARM_OVERDUE_GRACE_MS;
  }

  async runUpdate({ force = false, trigger = 'manual' } = {}) {
    const startedAt = new Date().toISOString();
    await this.putScheduler({ enabled: true, lastStartedAt: startedAt });

    try {
      const refreshStatus = await refreshSite(sqliteSiteCache(this.state.storage), PEOPLE_MAP, { force, apiKey: this.env.FOOTBALL_DATA_API_KEY });
      const status = {
        ...refreshStatus,
        trigger,
        durableObject: true,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      await this.state.storage.put('lastRun', status);
      return status;
    } catch (error) {
      const status = {
        updated: false,
        trigger,
        durableObject: true,
        startedAt,
        failedAt: new Date().toISOString(),
        error: serializeError(error),
      };
      await this.state.storage.put('lastRun', status);
      throw error;
    }
  }

  async scheduleNext({ onlyIfMissing = false, intervalMs = MATCH_WINDOW_INTERVAL_MS } = {}) {
    const existingAlarm = await this.state.storage.getAlarm();
    if (onlyIfMissing && existingAlarm) {
      return this.schedulerStatus();
    }

    const nextAlarm = nextAlarmTime(intervalMs);
    await this.state.storage.setAlarm(nextAlarm);
    await this.putScheduler({
      enabled: true,
      intervalSeconds: intervalMs / 1000,
      nextAlarmAt: new Date(nextAlarm).toISOString(),
    });
    return this.schedulerStatus();
  }

  async putScheduler(patch) {
    const scheduler = (await this.state.storage.get('scheduler')) ?? {};
    await this.state.storage.put('scheduler', { ...scheduler, ...patch });
  }

  async schedulerStatus() {
    const [alarmTime, scheduler, lastRun] = await Promise.all([
      this.state.storage.getAlarm(),
      this.state.storage.get('scheduler'),
      this.state.storage.get('lastRun'),
    ]);

    return {
      enabled: Boolean(alarmTime) && scheduler?.enabled !== false,
      intervalSeconds: scheduler?.intervalSeconds ?? null,
      nextAlarmAt: alarmTime ? new Date(alarmTime).toISOString() : null,
      scheduler: scheduler ?? null,
      lastRun: lastRun ?? null,
    };
  }
}

export default {
  async scheduled(event, env, ctx) {
    console.log('Scheduled Durable Object bootstrap started.', {
      cron: event.cron,
      scheduledTime: new Date(event.scheduledTime).toISOString(),
    });

    ctx.waitUntil((async () => {
      try {
        const status = await callScheduler(env, '/bootstrap', { method: 'POST' });
        console.log('Scheduled Durable Object bootstrap finished.', status);
      } catch (error) {
        console.error('Scheduled Durable Object bootstrap failed.', serializeError(error));
        throw error;
      }
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (url.pathname === '/health') {
      const [siteStatus, schedulerStatus] = await Promise.all([
        callScheduler(env, '/site-status'),
        callScheduler(env, '/status'),
      ]);
      return jsonResponse({
        site: siteStatus ?? { updated: false, reason: 'No scheduled refresh has run yet.' },
        scheduler: schedulerStatus,
      });
    }

    if (url.pathname === '/api/payload') {
      return jsonResponse(await callScheduler(env, '/payload'));
    }

    if (url.pathname === '/api/status') {
      return jsonResponse(await callScheduler(env, '/site-status'));
    }

    if (url.pathname === '/api/state') {
      return jsonResponse(await callScheduler(env, '/state'), {
        headers: {
          'cache-control': 'public, max-age=15',
        },
      });
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
      console.log('Manual Durable Object refresh requested.', { path: url.pathname });
      const status = await callScheduler(env, '/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true, trigger: 'manual' }),
      });
      console.log('Manual Durable Object refresh finished.', status);
      return jsonResponse(status);
    }

    if (url.pathname === '/scheduler/start' || url.pathname === '/scheduler/stop') {
      if (request.method !== 'POST') {
        return jsonResponse({ error: `Use POST ${url.pathname}.` }, { status: 405 });
      }
      if (!env.UPDATE_TOKEN) {
        return jsonResponse({ error: 'Scheduler management is disabled until UPDATE_TOKEN is configured.' }, { status: 503 });
      }
      if (!(await isAuthorized(request, env))) {
        return jsonResponse({ error: 'Unauthorized.' }, { status: 401 });
      }
      const schedulerPath = url.pathname.replace('/scheduler', '');
      return jsonResponse(await callScheduler(env, schedulerPath, { method: 'POST' }));
    }

    if (url.pathname === '/scheduler/status') {
      return jsonResponse(await callScheduler(env, '/status'));
    }

    return jsonResponse({
      service: 'worldcup-sweepstake-updater',
      endpoints: ['/health', '/api/state', '/api/payload', '/api/status', 'POST /refresh', 'POST /scheduler/start', 'POST /scheduler/stop', '/scheduler/status'],
    });
  },
};
