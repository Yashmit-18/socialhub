#!/usr/bin/env node
/**
 * SocialHub launcher for Windows, with a Cloudflare Quick Tunnel.
 *
 *   node scripts/socialhub-launcher.js start          tunnel + .env + API   (start-socialhub.cmd)
 *   node scripts/socialhub-launcher.js start-api      only the API          (start-socialhub-api.cmd)
 *   node scripts/socialhub-launcher.js start-tunnel   tunnel + .env         (start-socialhub-tunnel.cmd)
 *   node scripts/socialhub-launcher.js stop           what this launcher started (stop-socialhub.cmd)
 *   node scripts/socialhub-launcher.js status
 *
 * Options: --new-tunnel   start a fresh tunnel even if one to this API is already running
 *
 * How it works:
 *  - The API and cloudflared each run in their own console window ("SocialHub API",
 *    "SocialHub Tunnel"). The launcher records each window and process (PID + start time) in
 *    .socialhub/*.json and only ever stops processes it recorded itself. Nothing is stopped by
 *    executable name.
 *  - A Quick Tunnel's hostname is random and changes whenever a NEW tunnel starts. The launcher
 *    reads it from cloudflared's local metrics endpoint (/quicktunnel), validates it, and only
 *    then writes it to CLIENT_ORIGIN, APP_URL and API_PUBLIC_URL in apps/api/.env (nothing
 *    else in the file changes). A tunnel to this API that is already running is reused, so its
 *    URL stays the same.
 *  - The API reads .env only when it starts, so it is (re)started after the URL changed: only
 *    an API this launcher started is restarted; any other one is reported, never stopped.
 *  - Secret values from .env are never printed.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import util from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(ROOT, 'apps', 'api');
const ENV_PATH = path.join(API_DIR, '.env');
const STATE_DIR = path.join(ROOT, '.socialhub');
const URL_KEYS = ['CLIENT_ORIGIN', 'APP_URL', 'API_PUBLIC_URL'];
const QUICK_TUNNEL_HOST = /^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/;
const METRICS_PORTS = [20990, 20991, 20992, 20993, 20994, 20995, 20996, 20997, 20998, 20999];
const API_HEALTH_TIMEOUT_MS = 90_000;
const TUNNEL_TIMEOUT_MS = 60_000;
const PUBLIC_TIMEOUT_MS = 120_000;
/** Batch files need CRLF line endings. */
const CRLF = String.fromCharCode(13, 10);
/** The run scripts openWindow writes into .socialhub/. */
const RUN_SCRIPT = /^run-(?:api|tunnel)-[0-9a-f]+[.]cmd$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (text = '') => console.log(text);
const step = (text) => console.log(`- ${text}`);
const warn = (text) => console.log(`! ${text}`);

class LauncherError extends Error {}
const fail = (message) => {
  throw new LauncherError(message);
};

/* ------------------------------------------------------------------ processes (Windows) */

function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

const PROCESS_FIELDS =
  "ProcessId,ParentProcessId,Name,CommandLine,@{n='Created';e={[int64](($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds)}}";

function processes(filter) {
  const out = powershell(
    `$p = @(Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ${PROCESS_FIELDS}); ConvertTo-Json -InputObject $p -Compress -Depth 2`,
  ).trim();
  if (!out) return [];
  const list = JSON.parse(out);
  return (Array.isArray(list) ? list : [list]).map((p) => ({
    pid: p.ProcessId,
    parentPid: p.ParentProcessId,
    name: String(p.Name ?? '').toLowerCase(),
    commandLine: p.CommandLine ?? '',
    created: Number(p.Created),
  }));
}

const processInfo = (pid) =>
  Number.isInteger(pid) ? (processes(`ProcessId=${pid}`)[0] ?? null) : null;

/** A recorded process is still the same one: same PID, same start time (PIDs are reused). */
function stillRunning(record) {
  if (!record?.pid) return false;
  const info = processInfo(record.pid);
  return Boolean(
    info && Math.abs(info.created - record.created) < 2000 && info.name === record.name,
  );
}

function listeningPids(port) {
  const out = powershell(
    `@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) -join ','`,
  ).trim();
  return out ? out.split(',').map(Number).filter(Boolean) : [];
}

function listeningPorts(pid) {
  const out = powershell(
    `@(Get-NetTCPConnection -OwningProcess ${pid} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique) -join ','`,
  ).trim();
  return out ? out.split(',').map(Number).filter(Boolean) : [];
}

/**
 * Opens a new console window that runs `command` in `cwd` and shows its output. It goes through
 * a small run script started with `start`, so the window has a real console (output visible).
 * When the program stops, the window stays open with `stoppedMessage` until a key is pressed,
 * so a crash can be read. Returns the window's cmd.exe process (found by a one-off token).
 */
async function openWindow(role, title, command, cwd, stoppedMessage) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const token = randomBytes(6).toString('hex');
  const script = path.join(STATE_DIR, `run-${role}-${token}.cmd`);
  fs.writeFileSync(
    script,
    [
      '@echo off',
      `title ${title}`,
      `cd /d "${cwd}"`,
      command,
      'echo.',
      `echo ${stoppedMessage}`,
      'echo Press any key to close this window.',
      'pause >nul',
      '',
    ].join(CRLF),
  );
  spawn('cmd.exe', ['/d', '/c', `start "${title}" "${script}"`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: true,
  }).unref();
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    const window = processes("Name='cmd.exe'").find((p) =>
      p.commandLine.includes(`run-${role}-${token}.cmd`),
    );
    if (window) return { ...window, script };
    await sleep(300);
  }
  return null;
}

/** Removes run scripts whose window is closed (a running batch file must not be deleted). */
function pruneRunScripts() {
  let files;
  try {
    files = fs.readdirSync(STATE_DIR).filter((name) => RUN_SCRIPT.test(name));
  } catch {
    return;
  }
  if (!files.length) return;
  const open = processes("Name='cmd.exe'")
    .map((p) => p.commandLine)
    .join(' ');
  for (const name of files) {
    if (!open.includes(name)) fs.rmSync(path.join(STATE_DIR, name), { force: true });
  }
}

/** The program a window started (node.exe or cloudflared.exe), once it is running. */
async function waitForChild(windowPid, name, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const child = processes(`ParentProcessId=${windowPid}`).find((p) => p.name === name);
    if (child) return child;
    await sleep(400);
  }
  return null;
}

function stopTree(pid) {
  try {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    /* already gone */
  }
}

/* ------------------------------------------------------------------ launcher state */

const statePath = (role) => path.join(STATE_DIR, `${role}.json`);

function readState(role) {
  try {
    return JSON.parse(fs.readFileSync(statePath(role), 'utf8'));
  } catch {
    return null;
  }
}

function writeState(role, state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(statePath(role), `${JSON.stringify(state, null, 2)}\n`);
}

const clearState = (role) => fs.rmSync(statePath(role), { force: true });

/** The launcher's own record for `role` if its process still runs; stale records are removed. */
function ownedProcess(role) {
  const state = readState(role);
  if (!state) return null;
  if (stillRunning(state.process)) return state;
  // The program ended (crashed, closed, or the PC restarted). Its window, if still open, shows
  // why; it is left for the person to read and close.
  clearState(role);
  return { stale: true, ...state };
}

/* ------------------------------------------------------------------ .env */

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) fail(`apps/api/.env was not found (${ENV_PATH}).`);
  const buf = fs.readFileSync(ENV_PATH);
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) {
    fail('apps/api/.env is saved as UTF-16. Save it as UTF-8, then run the launcher again.');
  }
  const text = buf.toString('utf8');
  return { text, values: util.parseEnv(text) };
}

const keyOf = (line) => (line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/) || [])[1];
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');

/**
 * Puts `origin` into CLIENT_ORIGIN, APP_URL and API_PUBLIC_URL, keeping each line's quoting,
 * and changes nothing else. Refuses (without writing) if the file is not as expected.
 * Returns { changed, previous }.
 */
export function updateEnvText(text, origin) {
  if (!/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(origin))
    fail(`Refusing to write "${origin}": not a plain HTTPS origin.`);
  const values = util.parseEnv(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const keys = lines.map(keyOf).filter(Boolean);
  const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (duplicates.length)
    fail(
      `apps/api/.env defines ${[...new Set(duplicates)].join(', ')} more than once; fix that first.`,
    );
  for (const key of URL_KEYS) {
    if (!keys.includes(key))
      fail(`apps/api/.env has no ${key} line; add one (any https URL) first.`);
  }
  const previous = values.CLIENT_ORIGIN;
  if (!URL_KEYS.every((key) => values[key] === previous)) {
    fail(
      `CLIENT_ORIGIN, APP_URL and API_PUBLIC_URL in apps/api/.env are not all the same URL, so the launcher will not guess which to replace. Make them equal, then run it again.`,
    );
  }
  if (previous === origin) return { text, changed: false, previous };
  const out = lines.map((line) => {
    const key = keyOf(line);
    if (!URL_KEYS.includes(key)) return line;
    if (!previous || !line.includes(previous))
      fail(`Could not find the current URL on the ${key} line.`);
    return line.replace(previous, origin);
  });
  const next = out.join(eol);
  // Every other line, and every other value, must be exactly what it was.
  const after = util.parseEnv(next);
  const changedOther = Object.keys(values).filter(
    (key) => !URL_KEYS.includes(key) && sha(values[key]) !== sha(after[key] ?? '\0missing'),
  );
  if (changedOther.length || !URL_KEYS.every((key) => after[key] === origin)) {
    fail('The .env update did not come out as expected; nothing was written.');
  }
  return { text: next, changed: true, previous };
}

/**
 * Checks .env with the API's own configuration rules. The API's config module validates
 * process.env as soon as it is loaded, so the values are put there only for that moment and
 * removed again: windows the launcher opens later must not inherit them.
 */
async function verifyEnvWithApiConfig(values) {
  const saved = { ...process.env };
  let loadConfig;
  try {
    Object.assign(process.env, values);
    ({ loadConfig } = await import(
      pathToFileURL(path.join(API_DIR, 'src', 'config', 'env.js')).href
    ));
  } catch (err) {
    // The config module lists setting names and rules, never values.
    fail(`The API would not accept apps/api/.env:\n${err.message}`);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
  try {
    return loadConfig(values);
  } catch (err) {
    fail(`The API would not accept apps/api/.env:\n${err.message}`);
  }
  return null;
}

/* ------------------------------------------------------------------ checks */

function findOnPath(command) {
  try {
    return execFileSync('where.exe', [command], { encoding: 'utf8', windowsHide: true })
      .split(/\r?\n/)[0]
      .trim();
  } catch {
    return null;
  }
}

function findCloudflared() {
  const known = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
  return findOnPath('cloudflared') ?? (fs.existsSync(known) ? known : null);
}

async function checkMongo(uri) {
  const { default: mongoose } = await import('mongoose');
  const connection = mongoose.createConnection(uri, { serverSelectionTimeoutMS: 12_000 });
  try {
    await connection.asPromise();
    await connection.db.admin().command({ ping: 1 });
  } catch (err) {
    const reason = String(err?.message ?? err).replace(
      /mongodb(?:\+srv)?:\/\/\S+/gi,
      '[database URI]',
    );
    fail(
      `MongoDB is not reachable with MONGODB_URI from apps/api/.env: ${err?.name ?? 'Error'}: ${reason}`,
    );
  } finally {
    await connection.close().catch(() => {});
  }
}

function checkRedis(redisUrl) {
  let url;
  try {
    url = new URL(redisUrl);
  } catch {
    return Promise.resolve({ ok: false, reason: 'REDIS_URL is not a valid URL' });
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host: url.hostname, port: Number(url.port || 6379) });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(4000, () => done({ ok: false, reason: 'no answer' }));
    socket.on('error', (err) => done({ ok: false, reason: err.code ?? err.message }));
    socket.on('connect', () => socket.write('PING\r\n'));
    // +PONG, or an authentication request: either way a Redis server answered.
    socket.on('data', (data) =>
      done({ ok: /^(\+PONG|-NOAUTH|-ERR)/.test(String(data)), reason: String(data).trim() }),
    );
  });
}

async function fetchStatus(url, { timeoutMs = 8000, redirect = 'follow' } = {}) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect });
  } catch {
    return null;
  }
}

async function apiHealthy(port) {
  const res = await fetchStatus(`http://127.0.0.1:${port}/api/v1/health`, { timeoutMs: 5000 });
  if (!res) return null;
  const body = await res.json().catch(() => null);
  return { ok: res.ok && body?.status === 'ok', database: body?.database ?? 'unknown' };
}

/**
 * Which public URL a running API was started with. Asks its Facebook callback without a
 * `state`: it fails at once (no database access, nothing stored) and redirects to APP_URL.
 */
async function apiPublicOrigin(port) {
  const res = await fetchStatus(`http://127.0.0.1:${port}/api/v1/oauth/facebook/callback`, {
    redirect: 'manual',
  });
  const location = res?.headers.get('location');
  try {
    return location ? new URL(location).origin : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ tunnel */

async function quickTunnelHost(metricsPort) {
  const res = await fetchStatus(`http://127.0.0.1:${metricsPort}/quicktunnel`, { timeoutMs: 2000 });
  const host = res?.ok ? (await res.json().catch(() => null))?.hostname : null;
  return typeof host === 'string' && QUICK_TUNNEL_HOST.test(host) ? host : null;
}

/** A quick tunnel to this API that the launcher did not start (for example one started by hand). */
async function findOtherTunnel(port) {
  const target = new RegExp(
    `--url\\s+https?://(?:localhost|127\\.0\\.0\\.1):${port}(?![0-9])`,
    'i',
  );
  const candidates = processes("Name='cloudflared.exe'")
    .filter((p) => target.test(p.commandLine))
    .sort((a, b) => b.created - a.created);
  for (const candidate of candidates) {
    for (const metricsPort of listeningPorts(candidate.pid)) {
      const host = await quickTunnelHost(metricsPort);
      if (host) return { pid: candidate.pid, host };
    }
  }
  return null;
}

async function freePort(ports) {
  for (const port of ports) {
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  return null;
}

async function startTunnel(port, cloudflared) {
  const metricsPort = await freePort(METRICS_PORTS);
  if (!metricsPort)
    fail(
      `No free local port for the tunnel's status endpoint (${METRICS_PORTS[0]}-${METRICS_PORTS.at(-1)}).`,
    );
  const command = `"${cloudflared}" tunnel --protocol http2 --metrics 127.0.0.1:${metricsPort} --url http://localhost:${port}`;
  const window = await openWindow(
    'tunnel',
    'SocialHub Tunnel - stop with stop-socialhub.cmd',
    command,
    ROOT,
    'The SocialHub tunnel has stopped (exit code %ERRORLEVEL%).',
  );
  if (!window) fail('The tunnel window did not open.');
  const windowPid = window.pid;
  const tunnel = await waitForChild(windowPid, 'cloudflared.exe');
  if (!tunnel) {
    fail(
      'cloudflared did not start. Run start-socialhub-tunnel.cmd and read the "SocialHub Tunnel" window for the reason.',
    );
  }
  const until = Date.now() + TUNNEL_TIMEOUT_MS;
  let host = null;
  while (!host && Date.now() < until) {
    if (!processInfo(tunnel.pid)) {
      fail(
        'cloudflared stopped before the tunnel was ready. Read the "SocialHub Tunnel" window for the reason (often a network or firewall problem).',
      );
    }
    host = await quickTunnelHost(metricsPort);
    if (!host) await sleep(1000);
  }
  if (!host) {
    stopTree(windowPid);
    fail(
      `cloudflared did not report a valid *.trycloudflare.com address within ${TUNNEL_TIMEOUT_MS / 1000} s. Nothing was written to .env.`,
    );
  }
  writeState('tunnel', {
    host,
    metricsPort,
    startedAt: new Date().toISOString(),
    window: { pid: windowPid, name: 'cmd.exe', created: window.created, script: window.script },
    process: { pid: tunnel.pid, name: 'cloudflared.exe', created: tunnel.created },
  });
  return host;
}

/** Reuses a running tunnel to this API (the launcher's, then any other), or starts one. */
async function ensureTunnel(port, { newTunnel }) {
  const cloudflared = findCloudflared();
  if (!cloudflared)
    fail(
      'cloudflared is not installed (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).',
    );
  const owned = ownedProcess('tunnel');
  if (owned?.stale)
    warn('The tunnel started earlier by the launcher had stopped; a new one is started.');
  else if (owned && !newTunnel) {
    const host = await quickTunnelHost(owned.metricsPort);
    if (host) {
      step(`Tunnel already running (started by the launcher): https://${host}`);
      return { host, owned: true, started: false };
    }
    warn("The launcher's tunnel is running but reports no address; it is replaced.");
    stopTree(owned.window?.pid ?? owned.process.pid);
    clearState('tunnel');
  } else if (owned && newTunnel) {
    step("Stopping the launcher's current tunnel (--new-tunnel).");
    stopTree(owned.window?.pid ?? owned.process.pid);
    clearState('tunnel');
  }
  if (!newTunnel) {
    const other = await findOtherTunnel(port);
    if (other) {
      step(
        `Using the quick tunnel that is already running (PID ${other.pid}, not started by the launcher): https://${other.host}`,
      );
      return { host: other.host, owned: false, started: false };
    }
  }
  step('Starting a Cloudflare Quick Tunnel to http://localhost:' + port + ' (HTTP/2)...');
  const host = await startTunnel(port, cloudflared);
  step(`Tunnel ready: https://${host}`);
  return { host, owned: true, started: true };
}

/* ------------------------------------------------------------------ API */

async function waitForHealth(port, processRecord) {
  const until = Date.now() + API_HEALTH_TIMEOUT_MS;
  let last = null;
  while (Date.now() < until) {
    last = await apiHealthy(port);
    if (last?.ok) return last;
    if (processRecord && !processInfo(processRecord.pid)) {
      fail('The API stopped while starting. Read the "SocialHub API" window for the reason.');
    }
    await sleep(1000);
  }
  fail(
    last
      ? `The API answers but is not healthy (database: ${last.database}). Check MongoDB and the "SocialHub API" window.`
      : `The API did not answer on http://localhost:${port} within ${API_HEALTH_TIMEOUT_MS / 1000} s. Read the "SocialHub API" window.`,
  );
  return null;
}

async function startApi(port) {
  const command = `"${process.execPath}" --env-file-if-exists=.env src/server.js`;
  const window = await openWindow(
    'api',
    `SocialHub API (port ${port}) - stop with stop-socialhub.cmd`,
    command,
    API_DIR,
    'The SocialHub API has stopped (exit code %ERRORLEVEL%). Run start-socialhub.cmd to start it again.',
  );
  if (!window) fail('The API window did not open.');
  const windowPid = window.pid;
  const api = await waitForChild(windowPid, 'node.exe');
  if (!api) {
    fail(
      'The API process did not start. Run start-socialhub-api.cmd and read the "SocialHub API" window.',
    );
  }
  writeState('api', {
    port,
    startedAt: new Date().toISOString(),
    window: { pid: windowPid, name: 'cmd.exe', created: window.created, script: window.script },
    process: { pid: api.pid, name: 'node.exe', created: api.created },
  });
  return api;
}

async function stopOwnedApi(port, owned) {
  stopTree(owned.window?.pid ?? owned.process.pid);
  clearState('api');
  const until = Date.now() + 20_000;
  while (listeningPids(port).length && Date.now() < until) await sleep(500);
  if (listeningPids(port).length) fail(`Port ${port} is still in use after stopping the API.`);
}

/**
 * Makes sure an API is running on `port` and uses `origin` as its public URL.
 * Returns { state: 'started' | 'restarted' | 'running' | 'running-stale', owned }.
 */
async function ensureApi(port, env, origin) {
  const owned = ownedProcess('api');
  if (owned?.stale)
    warn(
      'The API started earlier by the launcher had stopped (its window may show why); it is started again.',
    );
  const ownedNow = owned && !owned.stale ? owned : null;
  const listeners = listeningPids(port);

  if (listeners.length && !ownedNow) {
    const health = await apiHealthy(port);
    const current = await apiPublicOrigin(port);
    if (!health)
      fail(
        `Port ${port} is used by another program (PID ${listeners.join(', ')}), not by SocialHub.`,
      );
    if (!origin || current === origin) {
      step(`API already running on port ${port} (not started by the launcher).`);
      return { state: 'running', owned: false, health };
    }
    warn(
      `An API on port ${port} that the launcher did not start (PID ${listeners.join(', ')}) still uses ${current ?? 'another URL'}.`,
    );
    warn(
      'It is left running. Stop it yourself (Ctrl+C in its window), then run start-socialhub.cmd again so it uses the new URL.',
    );
    return { state: 'running-stale', owned: false, health };
  }

  if (ownedNow) {
    const current = await apiPublicOrigin(port);
    if (!origin || current === origin) {
      step(`API already running on port ${port} (started by the launcher).`);
      return { state: 'running', owned: true, health: await waitForHealth(port, ownedNow.process) };
    }
    step(
      `Restarting the API: it was started with ${current ?? 'another URL'} and .env now says ${origin}. The API only reads .env when it starts.`,
    );
    await stopOwnedApi(port, ownedNow);
  }

  if (env.MONGODB_URI) {
    step('Checking MongoDB with MONGODB_URI from apps/api/.env...');
    await checkMongo(env.MONGODB_URI);
    step('MongoDB reachable.');
  }
  step(`Starting the API on port ${port} in its own window...`);
  const api = await startApi(port);
  const health = await waitForHealth(port, api);
  step(`API healthy (database ${health.database}).`);
  return { state: ownedNow ? 'restarted' : 'started', owned: true, health };
}

/* ------------------------------------------------------------------ commands */

async function preflight() {
  if (process.platform !== 'win32')
    fail('This launcher is for Windows. On other systems run the API and cloudflared yourself.');
  step(`Node.js ${process.version}`);
  if (!findOnPath('npm'))
    fail('npm was not found on PATH. Reinstall Node.js from https://nodejs.org.');
  const cloudflared = findCloudflared();
  if (!cloudflared)
    fail(
      'cloudflared was not found. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
    );
  step(`cloudflared found (${cloudflared})`);
  const { values } = readEnv();
  const port = Number(values.PORT || 4000);
  const dist = path.resolve(API_DIR, values.SERVE_WEB_DIST || '../web/dist', 'index.html');
  if (values.SERVE_WEB_DIST && !fs.existsSync(dist)) {
    warn(
      'The web app has not been built (apps/web/dist is missing): run "npm run build" in the project folder for the website to load.',
    );
  }
  const mode = (values.PUBLISHING_MODE || 'disabled').toLowerCase();
  if (values.REDIS_URL && mode !== 'disabled') {
    const redis = await checkRedis(values.REDIS_URL);
    if (redis.ok) step('Redis reachable (publishing queue).');
    else
      warn(
        `Redis is not reachable (${redis.reason}): the API starts, but posts cannot be queued until Redis runs (Memurai service).`,
      );
  }
  return { port, values, mode };
}

async function applyHostToEnv(host) {
  const origin = `https://${host}`;
  if (!QUICK_TUNNEL_HOST.test(host))
    fail(`"${host}" is not a valid Quick Tunnel hostname; nothing was written.`);
  const { text } = readEnv();
  const result = updateEnvText(text, origin);
  if (result.changed) {
    const tmp = `${ENV_PATH}.launcher-tmp`;
    fs.writeFileSync(tmp, result.text, 'utf8');
    fs.renameSync(tmp, ENV_PATH);
    step(`apps/api/.env updated: CLIENT_ORIGIN, APP_URL and API_PUBLIC_URL = ${origin}`);
  } else {
    step('apps/api/.env already uses this URL.');
  }
  const config = await verifyEnvWithApiConfig(readEnv().values);
  if (config.publicApiUrl !== origin || config.appUrl !== origin)
    fail('After the update the API would not use the new URL; check apps/api/.env.');
  return { origin, previous: result.previous, changed: result.changed, config };
}

async function verifyPublic(origin) {
  const until = Date.now() + PUBLIC_TIMEOUT_MS;
  let health = null;
  while (Date.now() < until) {
    health = await fetchStatus(`${origin}/api/v1/health`, { timeoutMs: 10_000 });
    if (health?.ok) break;
    await sleep(3000);
  }
  const page = health?.ok ? await fetchStatus(`${origin}/`, { timeoutMs: 15_000 }) : null;
  const html = page?.ok ? await page.text() : '';
  return { api: Boolean(health?.ok), website: /id="root"/.test(html) };
}

function printSummary({ port, origin, api, tunnel, mode, publicCheck, previous, changed }) {
  const line = '='.repeat(60);
  say();
  say(line);
  say(
    api.state === 'running-stale'
      ? 'SOCIALHUB STARTED, BUT THE API NEEDS A RESTART'
      : 'SOCIALHUB STARTED SUCCESSFULLY',
  );
  say(line);
  say();
  say('Local URL:');
  say(`  http://localhost:${port}`);
  say();
  say('Public URL (Cloudflare Quick Tunnel, changes when a new tunnel starts):');
  say(`  ${origin}`);
  say();
  say('API:');
  say(
    `  ${api.state === 'running-stale' ? 'RUNNING WITH THE OLD URL - restart it' : 'RUNNING'}${api.owned ? '' : ' (not started by the launcher)'}`,
  );
  say();
  say('Cloudflare Tunnel:');
  say(
    `  ${publicCheck.api ? 'CONNECTED' : 'STARTED, NOT REACHABLE YET (try the URL again in a minute)'}${tunnel.owned ? '' : ' (reused, not started by the launcher)'}`,
  );
  say(`  Website through the tunnel: ${publicCheck.website ? 'LOADS' : 'not confirmed'}`);
  say();
  say('Publishing:');
  say(`  ${mode.toUpperCase()}`);
  say();
  if (changed) {
    say(line);
    say('THE PUBLIC URL CHANGED');
    say(`  before: ${previous}`);
    say(`  now:    ${origin}`);
    say('Update these in the Meta Developer Dashboard before using Facebook login:');
    say(`  Valid OAuth Redirect URI:  ${origin}/api/v1/oauth/facebook/callback`);
    say(`  Deauthorize callback:      ${origin}/api/v1/meta/facebook/deauthorize`);
    say(`  Data deletion callback:    ${origin}/api/v1/meta/facebook/data-deletion`);
    say(`  App Domains:               ${new URL(origin).hostname}`);
    say(`  Privacy Policy URL:        ${origin}/privacy.html`);
    say(`  Terms of Service URL:      ${origin}/terms.html`);
    say(`  Data deletion instructions:${' '}${origin}/data-deletion.html`);
    say(line);
  }
  say('Stop everything the launcher started: stop-socialhub.cmd');
}

async function start({ newTunnel }) {
  say('Starting SocialHub...');
  const { port, mode } = await preflight();
  const tunnel = await ensureTunnel(port, { newTunnel });
  const env = await applyHostToEnv(tunnel.host);
  const api = await ensureApi(port, readEnv().values, env.origin);
  step('Checking the public URL (a new tunnel can take up to a minute to answer)...');
  const publicCheck = await verifyPublic(env.origin);
  printSummary({
    port,
    origin: env.origin,
    api,
    tunnel,
    mode,
    publicCheck,
    previous: env.previous,
    changed: env.changed,
  });
  return api.state === 'running-stale' ? 2 : 0;
}

async function startApiOnly() {
  const { port } = await preflight();
  const { values } = readEnv();
  const api = await ensureApi(port, values, null);
  say();
  say(
    `API ${api.state === 'started' ? 'started' : 'running'}: http://localhost:${port} (public URL in .env: ${values.API_PUBLIC_URL})`,
  );
  return 0;
}

async function startTunnelOnly({ newTunnel }) {
  const { port } = await preflight();
  const tunnel = await ensureTunnel(port, { newTunnel });
  const env = await applyHostToEnv(tunnel.host);
  say();
  say(`Public URL: ${env.origin}`);
  if (listeningPids(port).length) {
    const current = await apiPublicOrigin(port);
    if (current && current !== env.origin) {
      warn(
        `The running API still uses ${current}. Run start-socialhub.cmd (it restarts an API the launcher started) or restart the API yourself.`,
      );
    }
  } else {
    say('The API is not running: start it with start-socialhub-api.cmd or start-socialhub.cmd.');
  }
  if (env.changed)
    say(
      'The URL changed: update the Meta Dashboard URLs (see README, "Starting SocialHub on Windows").',
    );
  return 0;
}

function stop() {
  let stopped = 0;
  for (const role of ['tunnel', 'api']) {
    const state = readState(role);
    if (!state) continue;
    const label = role === 'api' ? 'API' : 'tunnel';
    const windowAlive = state.window && stillRunning(state.window);
    const processAlive = stillRunning(state.process);
    if (windowAlive || processAlive) {
      stopTree(windowAlive ? state.window.pid : state.process.pid);
      say(`Stopped the ${label} started by the launcher (PID ${state.process.pid}).`);
      stopped += 1;
    } else {
      say(`The ${label} started by the launcher was no longer running.`);
    }
    clearState(role);
  }
  if (!stopped) say('Nothing started by the launcher is running.');
  pruneRunScripts();
  const others = processes("Name='cloudflared.exe'").length;
  if (others) say(`Other cloudflared processes were left alone (${others}).`);
  return 0;
}

async function status() {
  const { values } = readEnv();
  const port = Number(values.PORT || 4000);
  const api = ownedProcess('api');
  const tunnel = ownedProcess('tunnel');
  const health = await apiHealthy(port);
  say(
    `API (port ${port}): ${health?.ok ? 'healthy' : health ? 'unhealthy' : 'not answering'}${api && !api.stale ? ' - started by the launcher' : ''}`,
  );
  say(
    `Tunnel: ${tunnel && !tunnel.stale ? `https://${tunnel.host} - started by the launcher` : 'none started by the launcher'}`,
  );
  say(`.env public URL: ${values.API_PUBLIC_URL}`);
  say(`Publishing: ${(values.PUBLISHING_MODE || 'disabled').toUpperCase()}`);
  return 0;
}

/* ------------------------------------------------------------------ main */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [command = 'start', ...flags] = process.argv.slice(2);
  const newTunnel = flags.includes('--new-tunnel');
  const commands = {
    start: () => start({ newTunnel }),
    'start-api': startApiOnly,
    'start-tunnel': () => startTunnelOnly({ newTunnel }),
    stop,
    status,
  };
  if (!commands[command]) {
    console.error(`Unknown command "${command}". Use: ${Object.keys(commands).join(', ')}`);
    process.exit(64);
  }
  try {
    if (command !== 'stop') pruneRunScripts();
    process.exitCode = await commands[command]();
  } catch (err) {
    say();
    say('SOCIALHUB DID NOT START CORRECTLY');
    say(err instanceof LauncherError ? err.message : `Unexpected error: ${err?.stack ?? err}`);
    process.exitCode = 1;
  }
  // Database connections or timers must not keep the launcher open.
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
}

export { QUICK_TUNNEL_HOST };
