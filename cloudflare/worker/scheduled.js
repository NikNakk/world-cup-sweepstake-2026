import { PEOPLE_MAP } from '../lib/people-map.js';
import { CACHE_KEYS, refreshSite } from '../lib/worldcup-renderer.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const SCHEDULER_OBJECT_NAME = 'worldcup-sweepstake-updater';
const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;
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

function nextAlarmTime(from = Date.now()) {
  return from + SCHEDULER_INTERVAL_MS;
}

function serializeError(error) {
  return {
    message: error?.message ?? String(error),
    stack: error?.stack,
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

    if (url.pathname === '/start' || url.pathname === '/bootstrap') {
      const status = await this.scheduleNext({ onlyIfMissing: url.pathname === '/bootstrap' });
      return jsonResponse(status);
    }

    if (url.pathname === '/stop') {
      await this.state.storage.deleteAlarm();
      await this.state.storage.put('scheduler', { enabled: false, stoppedAt: new Date().toISOString() });
      const status = await this.schedulerStatus();
      return jsonResponse({ ...status, stopped: true });
    }

    if (url.pathname === '/status') {
      return jsonResponse(await this.schedulerStatus());
    }

    return jsonResponse({ error: 'Unknown scheduler endpoint.' }, { status: 404 });
  }

  async alarm() {
    try {
      await this.runUpdate({ trigger: 'alarm' });
    } finally {
      await this.scheduleNext();
    }
  }

  async runUpdate({ force = false, trigger = 'manual' } = {}) {
    const startedAt = new Date().toISOString();
    await this.state.storage.put('scheduler', { enabled: true, lastStartedAt: startedAt });

    try {
      const refreshStatus = await refreshSite(this.env.WORLDCUP_SITE, PEOPLE_MAP, { force });
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

  async scheduleNext({ onlyIfMissing = false } = {}) {
    const existingAlarm = await this.state.storage.getAlarm();
    if (onlyIfMissing && existingAlarm) {
      return this.schedulerStatus();
    }

    const nextAlarm = nextAlarmTime();
    await this.state.storage.setAlarm(nextAlarm);
    await this.state.storage.put('scheduler', { enabled: true, nextAlarmAt: new Date(nextAlarm).toISOString() });
    return this.schedulerStatus();
  }

  async schedulerStatus() {
    const [alarmTime, scheduler, lastRun] = await Promise.all([
      this.state.storage.getAlarm(),
      this.state.storage.get('scheduler'),
      this.state.storage.get('lastRun'),
    ]);

    return {
      enabled: Boolean(alarmTime) && scheduler?.enabled !== false,
      intervalSeconds: SCHEDULER_INTERVAL_MS / 1000,
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

    if (url.pathname === '/health') {
      const [siteStatus, schedulerStatus] = await Promise.all([
        env.WORLDCUP_SITE.get(CACHE_KEYS.status, 'json'),
        callScheduler(env, '/status'),
      ]);
      return jsonResponse({
        site: siteStatus ?? { updated: false, reason: 'No scheduled refresh has run yet.' },
        scheduler: schedulerStatus,
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
      endpoints: ['/health', 'POST /refresh', 'POST /scheduler/start', 'POST /scheduler/stop', '/scheduler/status'],
    });
  },
};
