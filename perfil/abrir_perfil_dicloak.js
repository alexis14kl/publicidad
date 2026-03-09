const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');

const PROFILE_NAME = process.argv[2] || '#1 Chat Gpt PRO';
const CDP_URL = process.argv[3] || 'http://127.0.0.1:9333';
const PROFILE_DEBUG_PORT_HINT = process.argv[4] || '';
const OPENAPI_PORT_HINT = process.argv[5] || '';
const RUN_MODE = String(process.argv[6] || '').trim().toLowerCase();
const OPENAPI_SECRET_HINT = process.argv[7] || process.env.DICLOAK_API_SECRET || '';
const DEBUG_ONLY_MODE = RUN_MODE === 'debug-only';
const DEFAULT_PROFILE_DEBUG_PORT = null;
const CDP_DEBUG_INFO_PATH = path.join(
  process.env.APPDATA || '',
  'DICloak',
  'cdp_debug_info.json',
);
const DICLOAK_LOCAL_STORAGE_LEVELDB = path.join(
  process.env.APPDATA || '',
  'DICloak',
  'Local Storage',
  'leveldb',
);

const DEBUG_DIR = path.join(__dirname, '..', 'debug');
const WAIT_CDP_MS = 120000;
const WAIT_UI_MS = 120000;
const WAIT_OPEN_MS = 150000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(s) {
  return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function tokenize(s) {
  return normalize(s)
    .split(/[^a-z0-9#]+/i)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function looseMatch(candidate, wanted) {
  const c = normalize(candidate);
  const w = normalize(wanted);
  if (!c || !w) return false;
  if (c === w || c.includes(w) || w.includes(c)) return true;

  const wantedTokens = tokenize(wanted).filter((t) => !['de', 'la', 'el', 'pro'].includes(t));
  if (!wantedTokens.length) return false;
  return wantedTokens.every((t) => c.includes(t));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}

async function waitForCdp(baseUrl, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await httpGet(`${baseUrl}/json/version`);
      if (res.statusCode >= 200 && res.statusCode < 300 && res.body.includes('webSocketDebuggerUrl')) {
        return true;
      }
    } catch (_) {
      // retry
    }
    await sleep(1000);
  }
  return false;
}

function parsePortFromInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const p = Number(raw);
    return p > 0 && p <= 65535 ? p : null;
  }

  try {
    const u = new URL(raw);
    if (!u.port) return null;
    const p = Number(u.port);
    return p > 0 && p <= 65535 ? p : null;
  } catch (_) {
    return null;
  }
}

function parsePortFromEndpoint(endpoint) {
  const m = String(endpoint || '').trim().match(/:(\d+)$/);
  if (!m) return null;
  const p = Number(m[1]);
  return p > 0 && p <= 65535 ? p : null;
}

function isValidPortNumber(value) {
  const p = Number(value);
  return Number.isFinite(p) && p > 0 && p <= 65535;
}

function getOpenApiPortCandidatesFromLevelDb(limitFiles = 16) {
  const ports = new Set();
  try {
    if (!DICLOAK_LOCAL_STORAGE_LEVELDB || !fs.existsSync(DICLOAK_LOCAL_STORAGE_LEVELDB)) {
      return [];
    }

    const files = fs
      .readdirSync(DICLOAK_LOCAL_STORAGE_LEVELDB)
      .filter((f) => /\.(?:ldb|log)$/i.test(f))
      .map((name) => {
        const full = path.join(DICLOAK_LOCAL_STORAGE_LEVELDB, name);
        let stat = null;
        try {
          stat = fs.statSync(full);
        } catch (_) {
          stat = null;
        }
        return { full, mtime: stat?.mtimeMs || 0, size: stat?.size || 0 };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limitFiles);

    for (const file of files) {
      // No necesitamos leer blobs enormes para detectar apiPort.
      if (file.size > 30 * 1024 * 1024) continue;
      let text = '';
      try {
        text = fs.readFileSync(file.full).toString('latin1');
      } catch (_) {
        continue;
      }
      if (!text) continue;

      const re = /apiPort"\s*:\s*(\d{2,5})/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const p = Number(m[1]);
        if (isValidPortNumber(p) && p >= 1024) ports.add(p);
      }
    }
  } catch (_) {
    return [];
  }

  return Array.from(ports.values());
}

function getOpenApiSecretCandidatesFromLevelDb(limitFiles = 8) {
  const secrets = new Set();
  try {
    if (!DICLOAK_LOCAL_STORAGE_LEVELDB || !fs.existsSync(DICLOAK_LOCAL_STORAGE_LEVELDB)) {
      return [];
    }
    const files = fs
      .readdirSync(DICLOAK_LOCAL_STORAGE_LEVELDB)
      .filter((f) => /\.(?:ldb|log)$/i.test(f))
      .map((name) => {
        const full = path.join(DICLOAK_LOCAL_STORAGE_LEVELDB, name);
        let stat = null;
        try {
          stat = fs.statSync(full);
        } catch (_) {
          stat = null;
        }
        return { full, mtime: stat?.mtimeMs || 0, size: stat?.size || 0 };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limitFiles);

    for (const file of files) {
      if (file.size > 30 * 1024 * 1024) continue;
      let text = '';
      try {
        text = fs.readFileSync(file.full).toString('latin1');
      } catch (_) {
        continue;
      }
      if (!text) continue;

      const re = /apiSecret"\s*:\s*"([A-Za-z0-9_-]{6,128})"/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const secret = String(m[1] || '').trim();
        if (secret) secrets.add(secret);
      }
    }
  } catch (_) {
    return [];
  }

  return Array.from(secrets.values());
}

function isPortListening(port) {
  if (!isValidPortNumber(port)) return false;
  try {
    const netstat = execSync('netstat -ano -p tcp', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const re = new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+\\d+\\s*$`, 'im');
    return re.test(netstat);
  } catch (_) {
    return false;
  }
}

function isLocalDebugHost(endpoint) {
  const e = String(endpoint || '').toLowerCase();
  return (
    e.startsWith('127.0.0.1:') ||
    e.startsWith('0.0.0.0:') ||
    e.startsWith('[::1]:') ||
    e.startsWith('[::]:')
  );
}

function getPidImageMap() {
  const map = new Map();
  try {
    const out = execSync('tasklist /FO CSV /NH', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)","([^"]+)"/);
      if (!m) continue;
      const image = (m[1] || '').trim().toLowerCase();
      const pid = Number((m[2] || '').replace(/[^\d]/g, ''));
      if (!image || !Number.isFinite(pid) || pid <= 0) continue;
      map.set(pid, image);
    }
  } catch (_) {
    // ignore
  }
  return map;
}

function listCdpPortCandidates(excludePort) {
  const pidMap = getPidImageMap();
  const candidates = new Map();

  try {
    const netstat = execSync('netstat -ano -p tcp', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    for (const line of netstat.split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (!m) continue;
      const local = m[1] || '';
      const pid = Number(m[2]);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      if (!isLocalDebugHost(local)) continue;

      const port = parsePortFromEndpoint(local);
      if (!port || port === excludePort) continue;

      const image = (pidMap.get(pid) || '').toLowerCase();
      const imageScore = /ginsbrowser\.exe/.test(image)
        ? 30
        : /chrome\.exe/.test(image)
          ? 20
          : /dicloak\.exe/.test(image)
            ? -20
            : 0;

      const existing = candidates.get(port);
      const candidate = { port, pid, image, imageScore };
      if (!existing || candidate.imageScore > existing.imageScore) {
        candidates.set(port, candidate);
      }
    }
  } catch (_) {
    // ignore
  }

  return Array.from(candidates.values());
}

function listPortsFromProfileBrowserCommandLine(excludePort) {
  const ports = new Set();
  try {
    const cmd =
      "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Get-CimInstance Win32_Process | Where-Object { ($_.Name -ieq 'ginsbrowser.exe') -or ($_.Name -ieq 'chrome.exe') } | Select-Object -ExpandProperty CommandLine\"";
    const out = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    for (const line of out.split(/\r?\n/)) {
      const m = String(line).match(/--remote-debugging-port[=\s](\d{2,5})/i);
      if (!m) continue;
      const port = Number(m[1]);
      if (!port || port === excludePort) continue;
      if (port > 0 && port <= 65535) ports.add(port);
    }
  } catch (_) {
    // ignore
  }
  return Array.from(ports.values());
}

function parseEnvIdFromPath(text) {
  const s = String(text || '');
  const m = s.match(/[\\/]\.DICloakCache[\\/](\d{10,})[\\/]/i);
  return m ? m[1] : '';
}

function getRunningProfileBrowserProcessMeta() {
  try {
    const cmd =
      `powershell -NoProfile -ExecutionPolicy Bypass -Command ` +
      `"Get-CimInstance Win32_Process | Where-Object { ($_.Name -ieq 'ginsbrowser.exe') -or ($_.Name -ieq 'chrome.exe') } | ` +
      `Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"`;
    const out = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .map((p) => {
        const pid = Number(p?.ProcessId || 0);
        const commandLine = String(p?.CommandLine || '');
        const userDataDir = parseArgValueFromCmd(commandLine, 'user-data-dir');
        const envId = parseEnvIdFromPath(userDataDir || commandLine);
        return { pid, commandLine, envId };
      })
      .filter((x) => Number.isFinite(x.pid) && x.pid > 0);
  } catch (_) {
    return [];
  }
}

function getCdpDebugInfoPortCandidates(excludePort) {
  try {
    if (!CDP_DEBUG_INFO_PATH || !fs.existsSync(CDP_DEBUG_INFO_PATH)) return [];
    const raw = fs.readFileSync(CDP_DEBUG_INFO_PATH, 'utf8').trim();
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    const processMeta = getRunningProfileBrowserProcessMeta();
    const runningPids = new Set(processMeta.map((p) => p.pid));
    const runningEnvIds = new Set(processMeta.map((p) => p.envId).filter(Boolean));

    const byPort = new Map();
    const addCandidate = (value, keyEnvId = '') => {
      if (!value || typeof value !== 'object') return;

      const port = parsePortFromInput(value.debugPort || value.port || '');
      if (!port || port === excludePort) return;

      const envId = String(value.envId || keyEnvId || '').trim();
      const pid = Number(value.pid || 0);
      const ws = String(value.webSocketUrl || value.websocketUrl || '');

      let score = 100;
      if (envId && runningEnvIds.has(envId)) score += 100;
      if (Number.isFinite(pid) && pid > 0 && runningPids.has(pid)) score += 80;
      if (ws && ws.includes(`:${port}`)) score += 10;

      const candidate = { port, envId, pid, score, source: 'cdp_debug_info.json' };
      const prev = byPort.get(port);
      if (!prev || candidate.score > prev.score) {
        byPort.set(port, candidate);
      }
    };

    if (Array.isArray(parsed)) {
      for (const value of parsed) addCandidate(value, String(value?.envId || ''));
    } else if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed)) addCandidate(value, key);
    }

    return Array.from(byPort.values()).sort((a, b) => b.score - a.score);
  } catch (_) {
    return [];
  }
}

function getCdpDebugInfoPortForEnv(envId, excludePort) {
  if (!envId) return null;
  try {
    if (!CDP_DEBUG_INFO_PATH || !fs.existsSync(CDP_DEBUG_INFO_PATH)) return null;
    const raw = fs.readFileSync(CDP_DEBUG_INFO_PATH, 'utf8').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const entry = parsed && typeof parsed === 'object' ? parsed[envId] : null;
    if (!entry || typeof entry !== 'object') return null;
    const port = parsePortFromInput(entry.debugPort || entry.port || '');
    if (!port || port === excludePort) return null;
    return {
      port,
      envId,
      pid: Number(entry.pid || 0),
      source: 'cdp_debug_info.json',
    };
  } catch (_) {
    return null;
  }
}

async function waitForCdpDebugInfoPort(envId, excludePort, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const exact = getCdpDebugInfoPortForEnv(envId, excludePort);
    if (exact) return exact;

    const any = getCdpDebugInfoPortCandidates(excludePort);
    if (any.length > 0) return any[0];
    await sleep(700);
  }
  return null;
}

function getGinsbrowserPids() {
  try {
    const out = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process ginsbrowser -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"`,
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return out
      .split(/\r?\n/)
      .map((x) => Number(String(x).trim()))
      .filter((x) => Number.isFinite(x) && x > 0);
  } catch (_) {
    return [];
  }
}

function listListeningPortsForPids(pids, excludePort) {
  const wanted = new Set((pids || []).map((x) => Number(x)).filter((x) => x > 0));
  if (wanted.size === 0) return [];

  const ports = new Set();
  try {
    const netstat = execSync('netstat -ano -p tcp', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of netstat.split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (!m) continue;
      const local = String(m[1] || '');
      const pid = Number(m[2] || 0);
      if (!wanted.has(pid)) continue;
      const port = parsePortFromEndpoint(local);
      if (!port || port === excludePort) continue;
      if (!isLocalDebugHost(local)) continue;
      ports.add(port);
    }
  } catch (_) {
    // ignore
  }
  return Array.from(ports.values());
}

function parseArgValueFromCmd(commandLine, argName) {
  const cmd = String(commandLine || '');
  const re = new RegExp(
    `--${argName}(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|([^\\s]+))`,
    'i',
  );
  const m = cmd.match(re);
  if (!m) return '';
  return String(m[1] || m[2] || m[3] || '').trim();
}

function parseExePathFromCmd(commandLine) {
  const cmd = String(commandLine || '').trim();
  if (!cmd) return '';

  const quoted = cmd.match(/^"([^"]+\.exe)"/i);
  if (quoted) return quoted[1];

  const bare = cmd.match(/^([^\s"]+\.exe)\b/i);
  return bare ? bare[1] : '';
}

function getProfileBrowserContext() {
  try {
    const cmd =
      `powershell -NoProfile -ExecutionPolicy Bypass -Command ` +
      `"Get-CimInstance Win32_Process | Where-Object { ($_.Name -ieq 'ginsbrowser.exe') -or ($_.Name -ieq 'chrome.exe') } | ` +
      `Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress"`;

    const out = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (!out) return null;
    const parsed = JSON.parse(out);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    if (!list.length) return null;

    let best = null;

    for (const p of list) {
      const commandLine = String(p?.CommandLine || '');
      if (!commandLine) continue;

      const userDataDir = parseArgValueFromCmd(commandLine, 'user-data-dir');
      if (!userDataDir) continue;

      const exePath =
        String(p?.ExecutablePath || '').trim() || parseExePathFromCmd(commandLine);
      if (!exePath) continue;

      const typeArg = parseArgValueFromCmd(commandLine, 'type');
      const image = String(p?.Name || '').toLowerCase();
      const isMain = !typeArg;
      let score = 0;
      if (/ginsbrowser\.exe/.test(image)) score += 30;
      if (isMain) score += 40;
      if (/--proxy-server/i.test(commandLine)) score += 10;
      if (/chatgpt\.com/i.test(commandLine)) score += 5;

      const candidate = {
        exePath,
        userDataDir,
        envId: parseEnvIdFromPath(userDataDir || commandLine),
        score,
      };

      if (!best || candidate.score > best.score) best = candidate;
    }

    return best;
  } catch (_) {
    return null;
  }
}

function openUrlInProfileBrowser(url) {
  const ctx = getProfileBrowserContext();
  if (!ctx?.exePath) return false;

  try {
    const args = [];
    if (ctx.userDataDir) args.push(`--user-data-dir=${ctx.userDataDir}`);
    args.push('--new-window', url);

    const child = spawn(ctx.exePath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    console.log(`[OK] URL enviada al navegador del perfil: ${url}`);
    return true;
  } catch (_) {
    return false;
  }
}

async function httpRequest(url, method = 'GET', options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    let body = options?.body;
    const headers = Object.assign({}, options?.headers || {});
    if (body && typeof body !== 'string') {
      body = JSON.stringify(body);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }
    if (body && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = http.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
      },
    );
    req.on('error', reject);
    req.setTimeout(Number(options?.timeoutMs) > 0 ? Number(options.timeoutMs) : 2000, () =>
      req.destroy(new Error('timeout')),
    );
    if (body) req.write(body);
    req.end();
  });
}

async function probeCdpPort(port) {
  try {
    const versionRes = await httpGet(`http://127.0.0.1:${port}/json/version`);
    if (!(versionRes.statusCode >= 200 && versionRes.statusCode < 300)) return null;
    if (!versionRes.body.includes('webSocketDebuggerUrl')) return null;

    let score = 0;
    let hasChatgpt = false;
    let targetsCount = 0;

    const targetsRes = await httpGet(`http://127.0.0.1:${port}/json`);
    if (targetsRes.statusCode >= 200 && targetsRes.statusCode < 300) {
      try {
        const targets = JSON.parse(targetsRes.body);
        if (Array.isArray(targets)) {
          targetsCount = targets.length;
          hasChatgpt = targets.some((t) => /chatgpt\.com/i.test(`${t?.url || ''} ${t?.title || ''}`));
          if (hasChatgpt) score += 80;
          score += Math.min(targetsCount, 20);
        }
      } catch (_) {
        // ignore
      }
    }

    return { port, score, hasChatgpt, targetsCount };
  } catch (_) {
    return null;
  }
}

function collectPotentialDebugPorts(value, outSet, parentKey = '', depth = 0) {
  if (!outSet || depth > 7 || value == null) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPotentialDebugPorts(item, outSet, parentKey, depth + 1);
    }
    return;
  }

  const key = String(parentKey || '').toLowerCase();

  if (typeof value === 'number') {
    if (/port|debug|cdp|ws/.test(key) && isValidPortNumber(value)) {
      outSet.add(Number(value));
    }
    return;
  }

  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return;

    const p = parsePortFromInput(s);
    if (p) outSet.add(p);

    const re = /(?:127\.0\.0\.1|localhost):(\d{2,5})/gi;
    let m;
    while ((m = re.exec(s)) !== null) {
      const pp = Number(m[1]);
      if (isValidPortNumber(pp)) outSet.add(pp);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      collectPotentialDebugPorts(v, outSet, k, depth + 1);
    }
  }
}

function getOpenApiPortHints(excludePort) {
  const ports = [];
  const pushPort = (p) => {
    if (!isValidPortNumber(p)) return;
    if (p === excludePort) return;
    if (!ports.includes(p)) ports.push(p);
  };

  pushPort(parsePortFromInput(OPENAPI_PORT_HINT));
  for (const p of getOpenApiPortCandidatesFromLevelDb()) pushPort(p);

  return ports;
}

function getOpenApiSecretHints() {
  const secrets = [];
  const pushSecret = (s) => {
    const t = String(s || '').trim();
    if (!t) return;
    if (!secrets.includes(t)) secrets.push(t);
  };

  pushSecret(OPENAPI_SECRET_HINT);
  for (const s of getOpenApiSecretCandidatesFromLevelDb()) pushSecret(s);
  return secrets;
}

function buildOpenApiHeaderVariants(secret) {
  const variants = [{}];
  const key = String(secret || '').trim();
  if (!key) return variants;

  variants.push({ Authorization: key });
  variants.push({ Authorization: `Bearer ${key}` });
  variants.push({ 'x-api-key': key });
  variants.push({ 'X-API-KEY': key });
  variants.push({ 'api-key': key });
  variants.push({ 'x-openapi-key': key });
  return variants;
}

function withQuery(urlPath, queryKey, queryValue) {
  const sep = urlPath.includes('?') ? '&' : '?';
  return `${urlPath}${sep}${encodeURIComponent(queryKey)}=${encodeURIComponent(queryValue)}`;
}

async function resolvePortsFromOpenApi(apiPort, apiSecret, excludePort) {
  const discovered = new Set();
  if (!isValidPortNumber(apiPort) || apiPort === excludePort) return [];

  const base = `http://127.0.0.1:${apiPort}`;
  const paths = [
    '/v1/env/list',
    '/v1/env/running',
    '/v1/env/running/list',
    '/v1/env/open/list',
    '/v1/openapi/env/list',
    '/v1/openapi/env/running/list',
    '/v1/openapi/running_env/list',
    '/v1/browser/list',
    '/v1/openapi/browser/list',
    '/v1/env/list?page=1&pageSize=100',
  ];

  const headerVariants = buildOpenApiHeaderVariants(apiSecret);
  const attempted = new Set();

  const tryOne = async (method, pathWithQuery, headers, body) => {
    const key = `${method} ${pathWithQuery} ${JSON.stringify(headers || {})}`;
    if (attempted.has(key)) return;
    attempted.add(key);

    try {
      const res = await httpRequest(`${base}${pathWithQuery}`, method, {
        headers,
        body,
        timeoutMs: 1500,
      });
      if (!(res.statusCode >= 200 && res.statusCode < 300)) return;
      if (!res.body) return;
      let parsed;
      try {
        parsed = JSON.parse(res.body);
      } catch (_) {
        return;
      }
      collectPotentialDebugPorts(parsed, discovered);
    } catch (_) {
      // ignore and continue
    }
  };

  for (const pathOnly of paths) {
    for (const headers of headerVariants) {
      await tryOne('GET', pathOnly, headers);
      await tryOne('POST', pathOnly, headers, {});
    }

    if (apiSecret) {
      const q1 = withQuery(pathOnly, 'apiSecret', apiSecret);
      const q2 = withQuery(pathOnly, 'token', apiSecret);
      await tryOne('GET', q1, {});
      await tryOne('GET', q2, {});
      await tryOne('POST', q1, {}, {});
      await tryOne('POST', q2, {}, {});
    }
  }

  const out = Array.from(discovered.values()).filter((p) => isValidPortNumber(p) && p !== excludePort);
  return out;
}

async function detectProfileDebugPort(excludePort) {
  const hintPort = parsePortFromInput(PROFILE_DEBUG_PORT_HINT);
  if (hintPort && hintPort !== excludePort) {
    const hintProbe = await probeCdpPort(hintPort);
    if (hintProbe) return hintPort;
  }

  const jsonCandidates = getCdpDebugInfoPortCandidates(excludePort);
  let firstJsonPort = null;
  for (const c of jsonCandidates) {
    if (!firstJsonPort) firstJsonPort = c.port;
    const probe = await probeCdpPort(c.port);
    if (probe) return c.port;
  }
  if (firstJsonPort) return firstJsonPort;

  const processPorts = listPortsFromProfileBrowserCommandLine(excludePort);
  for (const p of processPorts) {
    const probe = await probeCdpPort(p);
    if (probe) return p;
  }

  const candidates = listCdpPortCandidates(excludePort);
  let best = null;

  for (const c of candidates) {
    const probe = await probeCdpPort(c.port);
    if (!probe) continue;
    const totalScore = probe.score + (c.imageScore || 0);

    if (!best || totalScore > best.totalScore) {
      best = { port: c.port, totalScore };
    }
  }

  if (best) return best.port;

  if (DEFAULT_PROFILE_DEBUG_PORT && DEFAULT_PROFILE_DEBUG_PORT !== excludePort) {
    const defaultProbe = await probeCdpPort(DEFAULT_PROFILE_DEBUG_PORT);
    if (defaultProbe) return DEFAULT_PROFILE_DEBUG_PORT;
  }

  return null;
}

async function waitForProfileDebugPort(excludePort, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const port = await detectProfileDebugPort(excludePort);
    if (port) return port;
    await sleep(1000);
  }
  return null;
}

async function openProfileDebugJsonWindow(cdpUrl) {
  const appPort = parsePortFromInput(cdpUrl);
  const hintPort = parsePortFromInput(PROFILE_DEBUG_PORT_HINT);
  const browserCtx = getProfileBrowserContext();
  const preferredEnvId = browserCtx?.envId || '';
  const processPorts = listPortsFromProfileBrowserCommandLine(appPort);
  const ginsPids = getGinsbrowserPids();
  const ginsListenPorts = listListeningPortsForPids(ginsPids, appPort);
  const jsonWaitCandidate = await waitForCdpDebugInfoPort(preferredEnvId, appPort, 30000);
  const jsonCandidates = getCdpDebugInfoPortCandidates(appPort);

  const candidatePorts = [];
  const sourceByPort = new Map();
  const pushCandidate = (port) => {
    if (!port || port === appPort) return;
    if (!candidatePorts.includes(port)) {
      candidatePorts.push(port);
    }
  };
  const pushCandidateWithSource = (port, source) => {
    if (!port || port === appPort) return;
    if (!candidatePorts.includes(port)) {
      candidatePorts.push(port);
    }
    if (source && !sourceByPort.has(port)) {
      sourceByPort.set(port, source);
    }
  };

  // Regla principal (MD): cdp_debug_info.json -> debugPort del perfil real.
  if (jsonWaitCandidate?.port) {
    pushCandidateWithSource(jsonWaitCandidate.port, 'cdp_debug_info.json(wait)');
  }
  for (const c of jsonCandidates) {
    pushCandidateWithSource(c.port, `cdp_debug_info.json(${c.envId || 'unknown'})`);
  }
  pushCandidateWithSource(hintPort, 'arg');

  // Fallback MD: puertos LISTEN de ginsbrowser/chrome asociados al perfil.
  for (const p of ginsListenPorts) pushCandidateWithSource(p, 'ginsbrowser-listen');
  for (const p of processPorts) pushCandidateWithSource(p, 'ginsbrowser-cmd');

  if (preferredEnvId) {
    console.log(`[INFO] envId preferido: ${preferredEnvId}`);
  }
  if (jsonWaitCandidate?.port) {
    console.log(`[INFO] cdp_debug_info.json detectado (wait): ${jsonWaitCandidate.port}`);
  }
  if (jsonCandidates.length > 0) {
    console.log(
      `[INFO] cdp_debug_info.json candidatos: ${jsonCandidates
        .map((c) => `${c.envId || '?'}:${c.port}`)
        .join(', ')}`,
    );
  } else {
    console.log('[WARN] cdp_debug_info.json sin debugPort util; aplicando fallback por ginsbrowser.');
  }
  if (ginsListenPorts.length > 0) {
    console.log(`[INFO] ginsbrowser puertos LISTENING: ${ginsListenPorts.join(', ')}`);
  } else {
    console.log('[WARN] ginsbrowser no expone puertos LISTENING (sin CDP real visible).');
  }

  const openViaJsonNew = async (port) => {
    const debugUrl = `http://127.0.0.1:${port}/json`;
    const createUrl = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(debugUrl)}`;
    try {
      let res = await httpRequest(createUrl, 'PUT');
      if (res.statusCode < 200 || res.statusCode >= 300) {
        // Algunas versiones aceptan GET en vez de PUT
        res = await httpRequest(createUrl, 'GET');
      }
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`[OK] Ventana debug del perfil abierta: ${debugUrl}`);
        return true;
      }
    } catch (_) {
      // continue
    }
    return false;
  };

  const livePorts = [];
  let selectedPort = null;
  for (const port of candidatePorts) {
    const probe = await probeCdpPort(port);
    if (probe) {
      livePorts.push(port);
      if (!selectedPort) selectedPort = port;
    }
  }

  if (selectedPort) {
    console.log(
      `[OK] Puerto real de debug del perfil: ${selectedPort} (source: ${sourceByPort.get(selectedPort) || 'unknown'})`,
    );
  }

  for (const port of livePorts) {
    const opened = await openViaJsonNew(port);
    if (opened) return true;
  }

  const orderedFallbackPorts = [
    ...livePorts,
    ...candidatePorts.filter((p) => !livePorts.includes(p)),
  ];

  for (const port of orderedFallbackPorts) {
    const debugUrl = `http://127.0.0.1:${port}/json`;
    if (openUrlInProfileBrowser(debugUrl)) {
      return true;
    }
  }

  console.log('[ERROR] No se detecto/abrio CDP real del perfil (sin debugPort valido en JSON ni fallback util).');
  console.log(
    '[INFO] Verifica manualmente: Get-Content "%APPDATA%\\DICloak\\cdp_debug_info.json" y fallback con Get-NetTCPConnection sobre PID de ginsbrowser.',
  );
  return false;
}

async function ensureEnvListPage(page) {
  await page.bringToFront();
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const href = window.location.href || '';
    if (!href.includes('/environment/envList')) {
      window.location.hash = '/environment/envList';
    }
  });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(() => {
      const txt = document.body?.innerText || '';
      const rows = document.querySelectorAll('.el-table__row').length;
      return txt.includes('Perfiles') || rows > 0;
    });
    if (ok) return;
    await sleep(500);
  }
}

async function applySearchFilter(page, profileName) {
  const candidates = [
    'input[placeholder*="Número/Nombre/Notas"]',
    'input[placeholder*="Numero/Nombre/Notas"]',
    'input[placeholder*="Number/Name/Notes"]',
    'input[placeholder*="Nombre"]',
    'input[placeholder*="Notes"]',
    'input[placeholder*="Name"]',
  ];

  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    try {
      await loc.click({ timeout: 1500 });
      await loc.fill('');
      await loc.fill(profileName);
      await loc.press('Enter');
      await page.waitForTimeout(600);
      return true;
    } catch (_) {
      // try next selector
    }
  }
  return false;
}

async function getVisibleRows(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.el-table__row'));
    return rows.map((row) => {
      const name =
        row.querySelector('.el-table_1_column_3 .sle')?.textContent ||
        row.querySelector('.el-table_1_column_3')?.textContent ||
        '';
      const btn =
        row.querySelector('td.el-table_1_column_13 button') ||
        row.querySelector('button');
      return {
        name: (name || '').replace(/\s+/g, ' ').trim(),
        btnText: (btn?.textContent || '').replace(/\s+/g, ' ').trim(),
        rowText: (row.innerText || '').replace(/\s+/g, ' ').trim(),
      };
    });
  });
}

async function findProfileRow(page, profileName) {
  const rows = await getVisibleRows(page);
  for (const row of rows) {
    if (looseMatch(row.name || row.rowText, profileName)) {
      return { found: true, ...row };
    }
  }
  return { found: false, rows };
}

async function getMatchingRowMeta(page, profileName) {
  return page.evaluate((targetName) => {
    const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const tokenize = (s) =>
      normalize(s)
        .split(/[^a-z0-9#]+/i)
        .map((x) => x.trim())
        .filter((x) => x.length >= 2);
    const looseMatch = (candidate, wanted) => {
      const c = normalize(candidate);
      const w = normalize(wanted);
      if (!c || !w) return false;
      if (c === w || c.includes(w) || w.includes(c)) return true;
      const wantedTokens = tokenize(wanted).filter((t) => !['de', 'la', 'el', 'pro'].includes(t));
      if (!wantedTokens.length) return false;
      return wantedTokens.every((t) => c.includes(t));
    };

    const rows = Array.from(document.querySelectorAll('.el-table__row'));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name =
        row.querySelector('.el-table_1_column_3 .sle')?.textContent ||
        row.querySelector('.el-table_1_column_3')?.textContent ||
        row.innerText ||
        '';
      if (!looseMatch(name, targetName)) continue;

      const checkboxInput = row.querySelector('td.el-table_1_column_1 .el-checkbox__input');
      const nativeCheckbox = row.querySelector('td.el-table_1_column_1 input[type="checkbox"]');
      const checked = Boolean(
        checkboxInput?.classList?.contains('is-checked') || nativeCheckbox?.checked,
      );

      return {
        found: true,
        index: i,
        checked,
        name: (name || '').replace(/\s+/g, ' ').trim(),
      };
    }
    return { found: false, index: -1, checked: false, name: '' };
  }, profileName);
}

async function isRowChecked(page, rowIndex) {
  return page.evaluate((index) => {
    const rows = Array.from(document.querySelectorAll('.el-table__row'));
    const row = rows[index];
    if (row) {
      const checkboxInput = row.querySelector('td.el-table_1_column_1 .el-checkbox__input');
      if (checkboxInput?.classList?.contains('is-checked')) return true;
    }

    // Fallback: en tablas con columnas fijas hay filas clonadas.
    const anyRowChecked = rows.some((r) =>
      Boolean(r.querySelector('td.el-table_1_column_1 .el-checkbox__input.is-checked')),
    );
    if (anyRowChecked) return true;

    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ');
    const selectedMatch = bodyText.match(/(\d+)\s+seleccionad/i);
    return Boolean(selectedMatch && Number(selectedMatch[1]) > 0);
  }, rowIndex);
}

async function ensureRowSelected(page, rowIndex) {
  if (await isRowChecked(page, rowIndex)) return true;

  const row = page.locator('.el-table__row').nth(rowIndex);
  const clickTargets = [
    row.locator('td.el-table_1_column_1 .el-checkbox__inner').first(),
    row.locator('td.el-table_1_column_1 label.el-checkbox').first(),
    row.locator('td.el-table_1_column_1 .cell').first(),
    row.locator('td.el-table_1_column_1 input[type="checkbox"]').first(),
  ];

  for (const target of clickTargets) {
    try {
      if ((await target.count()) === 0) continue;
      await target.click({ timeout: 2000, force: true });
      await page.waitForTimeout(250);
      if (await isRowChecked(page, rowIndex)) return true;
    } catch (_) {
      // try next target
    }
  }

  // Fallback: click nativo por DOM para sortear overlays/interceptores.
  try {
    const ok = await page.evaluate((index) => {
      const rows = Array.from(document.querySelectorAll('.el-table__row'));
      const row = rows[index];
      if (!row) return false;
      const input = row.querySelector('td.el-table_1_column_1 input[type="checkbox"]');
      if (!input) return false;
      input.click();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const checkboxInput = row.querySelector('td.el-table_1_column_1 .el-checkbox__input');
      return Boolean(checkboxInput?.classList?.contains('is-checked'));
    }, rowIndex);
    if (ok) return true;
  } catch (_) {
    // ignore
  }

  return false;
}

async function closeProfileIfRunning(page, profileName) {
  const meta = await getMatchingRowMeta(page, profileName);
  if (!meta.found) return { ok: false, reason: 'row_not_found' };

  const row = page.locator('.el-table__row').nth(meta.index);
  const opButton = row.locator('td.el-table_1_column_13 button').first();

  for (let attempt = 0; attempt < 3; attempt++) {
    await dismissAnyDialog(page);

    try {
      if ((await opButton.count()) === 0) return { ok: false, reason: 'close_button_not_found' };
      if (!(await opButton.isVisible())) return { ok: false, reason: 'close_button_not_visible' };
    } catch {
      return { ok: false, reason: 'close_button_unavailable' };
    }

    const currentText = ((await opButton.textContent()) || '').replace(/\s+/g, ' ').trim();
    if (!/cerrar|close/i.test(currentText)) {
      return { ok: true };
    }

    try {
      await opButton.click({ timeout: 5000, force: true });
    } catch (_) {
      // retry
    }

    const waitStart = Date.now();
    while (Date.now() - waitStart < 8000) {
      await dismissAnyDialog(page);
      try {
        const txt = ((await opButton.textContent()) || '').replace(/\s+/g, ' ').trim();
        if (!/cerrar|close/i.test(txt)) return { ok: true };
      } catch (_) {
        // keep polling
      }
      await sleep(500);
    }
  }

  return { ok: false, reason: 'close_timeout' };
}

async function clickProfileOpen(page, profileName) {
  const meta = await getMatchingRowMeta(page, profileName);
  if (!meta.found) return { ok: false, reason: 'row_not_found' };

  await dismissAnyDialog(page);
  const selected = await ensureRowSelected(page, meta.index);
  const row = page.locator('.el-table__row').nth(meta.index);
  const rowOpenBtn = row.locator('td.el-table_1_column_13 button:has-text("Abrir")').first();
  const rowOpenBtnEn = row.locator('td.el-table_1_column_13 button:has-text("Open")').first();

  if (!selected) {
    // fallback duro: intentar abrir por boton de fila cuando la seleccion masiva falla.
    for (const rb of [rowOpenBtn, rowOpenBtnEn]) {
      try {
        if ((await rb.count()) === 0) continue;
        if (!(await rb.isVisible())) continue;
        const txt = ((await rb.textContent()) || '').replace(/\s+/g, ' ').trim();
        await rb.click({ timeout: 5000, force: true });
        return { ok: true, mode: 'row-open-fallback', openText: txt, selectedConfirmed: false };
      } catch (_) {
        // next
      }
    }
    return { ok: false, reason: 'checkbox_click_failed' };
  }
  const selectedConfirmed = await isRowChecked(page, meta.index);
  if (!selectedConfirmed) return { ok: false, reason: 'checkbox_not_confirmed' };

  const openCandidates = [
    rowOpenBtn,
    rowOpenBtnEn,
    page.getByRole('button', { name: /^Abrir perfil$/i }).first(),
    page.getByRole('button', { name: /Abrir perfil/i }).first(),
    page.locator('button:has-text("Abrir perfil")').first(),
    page.locator('.el-button:has-text("Abrir perfil")').first(),
    // Toolbar de DiCloak (no siempre es <button>, a veces es <div> clickeable)
    page
      .locator('div.tw-flex.tw-items-center div.tw-cursor-pointer:has-text("Abrir perfil")')
      .first(),
    page.locator('div.tw-w-fit.c-flex.tw-cursor-pointer:has-text("Abrir perfil")').first(),
    page.locator('button:has-text("Open profile")').first(),
    // fallback: boton flotante "Abrir perfil (41): Inicializando"
    page.locator('button:has-text("Abrir perfil (")').first(),
  ];

  const findVisibleOpenCandidate = async () => {
    for (const candidate of openCandidates) {
      try {
        if ((await candidate.count()) === 0) continue;
        if (!(await candidate.isVisible())) continue;
        return candidate;
      } catch (_) {
        // try next
      }
    }
    return null;
  };

  // Espera corta para que aparezca/actualice la barra superior de acciones.
  try {
    await page.locator('text=/seleccionad/i').first().waitFor({ timeout: 3000 });
  } catch {
    // no bloqueante
  }

  let clickableOpen = await findVisibleOpenCandidate();

  if (!clickableOpen) {
    return { ok: false, reason: 'toolbar_open_button_not_found' };
  }

  for (const candidate of [clickableOpen, ...openCandidates]) {
    try {
      if ((await candidate.count()) === 0) continue;
      if (!(await candidate.isVisible())) continue;
      const ariaDisabled = (await candidate.getAttribute('aria-disabled')) || '';
      const disabledAttr = await candidate.getAttribute('disabled');
      if (ariaDisabled === 'true' || disabledAttr !== null) continue;

      const openText = ((await candidate.textContent()) || '').replace(/\s+/g, ' ').trim();
      await candidate.click({ timeout: 5000 });
      return { ok: true, mode: 'checkbox+toolbar', openText, selectedConfirmed };
    } catch {
      // try next
    }
  }

  return { ok: false, reason: 'toolbar_open_button_not_found' };
}

async function readOpenFeedback(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();

    const failurePatterns = [
      'no pudo abrirse',
      'no se pudo abrir',
      'failed to open',
      'cannot be opened',
      'open failed',
      '无法打开',
      '打开失败',
    ];
    const openingPatterns = ['inicializando', 'abriendo', 'opening'];

    const failureHit = failurePatterns.find((p) => lower.includes(p)) || '';
    const opening = openingPatterns.some((p) => lower.includes(p));

    return {
      hasFailure: Boolean(failureHit),
      failureHit,
      opening,
      hasCloseWord: /\bcerrar\b|\bclose\b/i.test(text),
      textSnippet: text.slice(0, 600),
    };
  });
}

async function dismissAnyDialog(page) {
  let closedSomething = false;
  const hasModal = async () =>
    page.evaluate(() => Boolean(document.querySelector('.el-overlay-message-box')));

  for (let i = 0; i < 4; i++) {
    if (!(await hasModal())) break;

    const candidates = [
      page.locator('.el-message-box__headerbtn').first(),
      page.getByRole('button', { name: /Aceptar|OK|Entendido|Confirmar|Cerrar|Close/i }).first(),
      page.locator('.el-message-box__btns .el-button--primary').first(),
      page.locator('button.el-button--primary').first(),
    ];

    let acted = false;
    for (const candidate of candidates) {
      try {
        if ((await candidate.count()) === 0) continue;
        if (!(await candidate.isVisible())) continue;
        await candidate.click({ timeout: 1200, force: true });
        acted = true;
        closedSomething = true;
        break;
      } catch (_) {
        // try next
      }
    }

    if (!acted) {
      try {
        await page.keyboard.press('Escape');
      } catch (_) {
        // ignore
      }
    }

    await page.waitForTimeout(300);
  }

  return closedSomething;
}

async function wasProfileWindowOpened(context, envListPage) {
  const pages = context.pages();
  if (pages.length > 1) return true;
  return pages.some((p) => p !== envListPage && !/environment\/envList/i.test(p.url() || ''));
}

async function reselectForVisualConfirmation(page, profileName) {
  try {
    await dismissAnyDialog(page);
    const meta = await getMatchingRowMeta(page, profileName);
    if (!meta.found) return false;
    return await ensureRowSelected(page, meta.index);
  } catch (_) {
    return false;
  }
}

async function saveDebugScreenshot(page, name) {
  try {
    const p = path.join(DEBUG_DIR, name);
    await page.screenshot({ path: p, fullPage: true });
    console.log(`[DEBUG] Screenshot: ${p}`);
  } catch (_) {
    // ignore
  }
}

async function main() {
  console.log(`[INFO] Perfil objetivo: ${PROFILE_NAME}`);
  if (DEBUG_ONLY_MODE) {
    console.log('[INFO] Modo: debug-only (solo deteccion/apertura de puerto dinamico).');
  }
  console.log(`[INFO] Esperando CDP de DiCloak en ${CDP_URL} ...`);

  const cdpReady = await waitForCdp(CDP_URL, WAIT_CDP_MS);
  if (!cdpReady) {
    console.error('[ERROR] No responde CDP. Verifica que DiCloak se abrio con --remote-debugging-port=9333');
    process.exit(1);
  }

  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const context = browser.contexts()[0];
    if (!context) {
      console.error('[ERROR] No se encontro contexto CDP en DiCloak.');
      process.exit(1);
    }

    if (DEBUG_ONLY_MODE) {
      const debugOpened = await openProfileDebugJsonWindow(CDP_URL);
      if (!debugOpened) process.exit(1);
      return;
    }

    let page =
      context.pages().find((p) => (p.url() || '').includes('/environment/envList')) ||
      context.pages()[0];
    if (!page) page = await context.newPage();

    await ensureEnvListPage(page);

    const searchApplied = await applySearchFilter(page, PROFILE_NAME);
    if (searchApplied) {
      console.log('[INFO] Filtro aplicado en buscador de tabla.');
    } else {
      console.log('[WARN] No se encontro input de filtro; se intenta por filas visibles.');
    }

    const uiStart = Date.now();
    while (Date.now() - uiStart < WAIT_UI_MS) {
      const state = await findProfileRow(page, PROFILE_NAME);
      if (state.found) {
        console.log(`[INFO] Perfil encontrado: ${state.name}`);
        console.log(`[INFO] Estado boton: ${state.btnText || '(sin texto)'}`);

        if (/cerrar|close/i.test(state.btnText || '')) {
          console.log(
            '[INFO] El perfil ya estaba abierto (posible segundo plano). Reiniciando para forzar ventana...',
          );
          const closeRes = await closeProfileIfRunning(page, PROFILE_NAME);
          if (!closeRes.ok) {
            console.error(`[ERROR] No se pudo cerrar perfil abierto: ${closeRes.reason}`);
            await saveDebugScreenshot(page, 'debug_dicloak_close_running_error.png');
            process.exit(1);
          }
          console.log('[INFO] Perfil cerrado. Intentando abrir nuevamente...');
        }

        const clickRes = await clickProfileOpen(page, PROFILE_NAME);
        if (!clickRes.ok) {
          console.error(`[ERROR] No se pudo hacer click: ${clickRes.reason}`);
          await saveDebugScreenshot(page, 'debug_dicloak_click_error.png');
          process.exit(1);
        }
        console.log(
          `[INFO] Accion realizada por ${clickRes.mode || 'fila'}: "${clickRes.openText || ''}"`,
        );
        console.log(`[INFO] Checkbox seleccionado antes de abrir: ${clickRes.selectedConfirmed ? 'SI' : 'NO'}`);

        const openStart = Date.now();
        let retriedAfterFailure = false;
        while (Date.now() - openStart < WAIT_OPEN_MS) {
          if (await wasProfileWindowOpened(context, page)) {
            console.log('[OK] Se detecto nueva ventana/pestana del perfil.');
            return;
          }

          const feedback = await readOpenFeedback(page);
          if (feedback.hasFailure) {
            console.error(`[WARN] DiCloak respondio: ${feedback.failureHit}`);
            await dismissAnyDialog(page);

            if (!retriedAfterFailure) {
              retriedAfterFailure = true;
              console.log('[INFO] Reintentando apertura una vez...');
              const retryRes = await clickProfileOpen(page, PROFILE_NAME);
              if (!retryRes.ok) {
                console.error(`[ERROR] Reintento fallido al hacer click: ${retryRes.reason}`);
                await saveDebugScreenshot(page, 'debug_dicloak_retry_click_error.png');
                process.exit(1);
              }
              continue;
            }

            console.error('[ERROR] DiCloak reporta que no pudo abrir el perfil.');
            await reselectForVisualConfirmation(page, PROFILE_NAME);
            await saveDebugScreenshot(page, 'debug_dicloak_open_failed_notification.png');
            process.exit(1);
          }

          const after = await findProfileRow(page, PROFILE_NAME);
          if (after.found) {
            if (/cerrar|close/i.test(after.btnText || '')) {
              console.log('[OK] Perfil abierto correctamente.');
              return;
            }
            if (/abriendo|opening/i.test(after.btnText || '')) {
              // still opening
            }
          }
          await sleep(1000);
        }

        console.log(
          '[WARN] No hubo confirmacion visual de "Cerrar", pero el click en "Abrir perfil" se ejecuto.',
        );
        await saveDebugScreenshot(page, 'debug_dicloak_open_uncertain.png');
        return;
      }

      await sleep(1000);
    }

    console.error('[ERROR] No se encontro el perfil en filas visibles.');
    const rows = await getVisibleRows(page);
    console.error(
      '[DEBUG] Filas visibles:',
      rows.slice(0, 10).map((r) => `${r.name} | ${r.btnText}`).join(' || '),
    );
    await saveDebugScreenshot(page, 'debug_dicloak_profile_not_found.png');
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[ERROR] Fallo inesperado:', err?.message || err);
  process.exit(1);
});
