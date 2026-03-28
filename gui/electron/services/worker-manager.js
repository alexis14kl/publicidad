const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { PROJECT_ROOT } = require('../config/project-paths')
const { getProjectEnv } = require('../utils/env')
const { runSqliteJson, runSqlite, sqlLiteral } = require('../utils/sqlite')
const { findPython, killProcessTree, isPidAlive } = require('../utils/process')
const state = require('../state')

// ---------------------------------------------------------------------------
// SQLite access (reuses the same publicidad.sqlite3 as Python)
// ---------------------------------------------------------------------------

const DB_PATH = path.join(PROJECT_ROOT, 'publicidad.sqlite3')

let _schemaReady = false

function _ensureSchema() {
  if (_schemaReady) return
  runSqlite(DB_PATH, `
    CREATE TABLE IF NOT EXISTS job_queue (
      job_id       TEXT PRIMARY KEY,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      action       TEXT NOT NULL,
      worker_type  TEXT NOT NULL,
      priority     INTEGER NOT NULL DEFAULT 50,
      status       TEXT NOT NULL DEFAULT 'queued',
      resource_key TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      run_id       TEXT,
      worker_pid   INTEGER,
      claimed_at   TEXT,
      started_at   TEXT,
      finished_at  TEXT,
      result_json  TEXT NOT NULL DEFAULT '{}',
      error_text   TEXT NOT NULL DEFAULT '',
      retry_count  INTEGER NOT NULL DEFAULT 0,
      max_retries  INTEGER NOT NULL DEFAULT 2,
      source       TEXT NOT NULL DEFAULT 'gui',
      company_name TEXT NOT NULL DEFAULT '',
      log_file     TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS job_queue_status_idx ON job_queue (status, priority, created_at);
    CREATE INDEX IF NOT EXISTS job_queue_worker_type_idx ON job_queue (worker_type, status);
    CREATE INDEX IF NOT EXISTS job_queue_resource_key_idx ON job_queue (resource_key, status);
    CREATE TABLE IF NOT EXISTS resource_locks (
      resource_key TEXT PRIMARY KEY,
      job_id       TEXT NOT NULL,
      acquired_at  TEXT NOT NULL,
      expires_at   TEXT NOT NULL,
      worker_pid   INTEGER
    );
  `)
  _schemaReady = true
}

function _dbQuery(sql) {
  _ensureSchema()
  return runSqliteJson(DB_PATH, sql)
}

function _dbExec(sql) {
  _ensureSchema()
  return runSqlite(DB_PATH, sql)
}

function _nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function _genJobId() {
  const d = new Date()
  const ts = d.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const hex = Math.random().toString(16).slice(2, 10)
  return `job_${ts}_${hex}`
}

// ---------------------------------------------------------------------------
// Concurrency limits
// ---------------------------------------------------------------------------

const LIMITS = {
  cdp:      { max: 1, perResource: true },
  api:      { max: 4, perResource: false },
  publish:  { max: 3, perResource: true },
  video:    { max: 1, perResource: false },
  brochure: { max: 2, perResource: false },
}

// ---------------------------------------------------------------------------
// Active workers (in-memory tracking)
// ---------------------------------------------------------------------------

const activeWorkers = new Map() // job_id -> { process, jobRow, logFile, logFd }

let _tickInterval = null

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function start() {
  if (_tickInterval) return
  _ensureSchema()
  _cleanupOrphanedJobs()
  _cleanupOldLogs()
  _tickInterval = setInterval(_safeTick, 1000)
}

function stop() {
  if (_tickInterval) {
    clearInterval(_tickInterval)
    _tickInterval = null
  }
}

function shutdown() {
  stop()
  for (const [jobId, worker] of activeWorkers) {
    try { killProcessTree(worker.process.pid) } catch { /* ignore */ }
    _finishJob(jobId, 'cancelled', null, 'App shutdown')
  }
  activeWorkers.clear()
}

function enqueueJob({ action, workerType, resourceKey, payload, priority = 50, source = 'gui', companyName = '' }) {
  const jobId = _genJobId()
  const now = _nowIso()
  const wtype = workerType || _classifyWorkerType(action)
  const rkey = resourceKey != null ? resourceKey : _classifyResourceKey(action, payload)
  const payloadStr = JSON.stringify(payload || {}).replace(/'/g, "''")

  _dbExec(`
    INSERT INTO job_queue(
      job_id, created_at, updated_at, action, worker_type, priority,
      status, resource_key, payload_json, source, company_name
    ) VALUES (
      ${sqlLiteral(jobId)}, ${sqlLiteral(now)}, ${sqlLiteral(now)},
      ${sqlLiteral(action)}, ${sqlLiteral(wtype)}, ${priority},
      'queued', ${sqlLiteral(rkey)}, '${payloadStr}',
      ${sqlLiteral(source)}, ${sqlLiteral(companyName)}
    );
  `)

  // Trigger immediate tick so the job starts without waiting 1s
  setImmediate(_safeTick)
  return jobId
}

function cancelJob(jobId) {
  const worker = activeWorkers.get(jobId)
  if (worker) {
    try { killProcessTree(worker.process.pid) } catch { /* ignore */ }
    _finishJob(jobId, 'cancelled', null, 'Cancelled by user')
    return true
  }
  // If queued but not started
  const rows = _dbQuery(`SELECT status FROM job_queue WHERE job_id = ${sqlLiteral(jobId)}`)
  if (rows.length > 0 && (rows[0].status === 'queued' || rows[0].status === 'claimed')) {
    const now = _nowIso()
    _dbExec(`UPDATE job_queue SET status = 'cancelled', updated_at = ${sqlLiteral(now)}, finished_at = ${sqlLiteral(now)} WHERE job_id = ${sqlLiteral(jobId)}`)
    return true
  }
  return false
}

function listJobs({ status, limit = 50 } = {}) {
  if (status && Array.isArray(status) && status.length > 0) {
    const inClause = status.map(s => sqlLiteral(s)).join(',')
    return _dbQuery(`SELECT * FROM job_queue WHERE status IN (${inClause}) ORDER BY priority ASC, created_at DESC LIMIT ${limit}`)
  }
  return _dbQuery(`SELECT * FROM job_queue ORDER BY created_at DESC LIMIT ${limit}`)
}

function getJobDetail(jobId) {
  const rows = _dbQuery(`SELECT * FROM job_queue WHERE job_id = ${sqlLiteral(jobId)}`)
  return rows.length > 0 ? rows[0] : null
}

function getActiveCount() {
  return activeWorkers.size
}

// ---------------------------------------------------------------------------
// Tick — the scheduler loop
// ---------------------------------------------------------------------------

function _safeTick() {
  try { tick() } catch (err) {
    console.error('[worker-manager] tick error:', err.message)
  }
}

function tick() {
  // Clean expired resource locks
  const now = _nowIso()
  try { _dbExec(`DELETE FROM resource_locks WHERE expires_at < ${sqlLiteral(now)}`) } catch { /* ignore */ }

  // Clean dead workers
  for (const [jobId, worker] of activeWorkers) {
    if (!isPidAlive(worker.process.pid)) {
      _finishJob(jobId, 'error', null, 'Worker process died unexpectedly')
    }
  }

  // For each worker type, check if we can start more jobs
  for (const wtype of Object.keys(LIMITS)) {
    const limit = LIMITS[wtype]
    const running = _countActive(wtype)

    if (!limit.perResource && running.total >= limit.max) continue

    // Fetch queued jobs for this worker type
    const lockedResources = limit.perResource ? _getLockedResources(wtype) : []
    let excludeClause = ''
    if (lockedResources.length > 0) {
      excludeClause = ` AND resource_key NOT IN (${lockedResources.map(k => sqlLiteral(k)).join(',')})`
    }

    const candidates = _dbQuery(
      `SELECT * FROM job_queue WHERE status = 'queued' AND worker_type = ${sqlLiteral(wtype)}${excludeClause} ORDER BY priority ASC, created_at ASC LIMIT 10`
    )

    for (const job of candidates) {
      if (!limit.perResource && _countActive(wtype).total >= limit.max) break
      if (limit.perResource && job.resource_key && _isResourceLocked(job.resource_key)) continue
      _spawnWorker(job)
    }
  }
}

// ---------------------------------------------------------------------------
// Spawn a worker subprocess
// ---------------------------------------------------------------------------

function _spawnWorker(jobRow) {
  // Acquire resource lock
  if (jobRow.resource_key) {
    const acquired = _acquireResource(jobRow.resource_key, jobRow.job_id)
    if (!acquired) return
  }

  // Create per-job log directory
  const logsDir = path.join(PROJECT_ROOT, 'logs', 'jobs')
  fs.mkdirSync(logsDir, { recursive: true })
  const logFile = path.join(logsDir, `${jobRow.job_id}.log`)

  // Open log file descriptor for subprocess stdout+stderr
  let logFd
  try {
    logFd = fs.openSync(logFile, 'w')
  } catch {
    _releaseResource(jobRow.resource_key)
    return
  }

  const pythonBin = findPython()
  if (!pythonBin) {
    fs.closeSync(logFd)
    _releaseResource(jobRow.resource_key)
    const now = _nowIso()
    _dbExec(`UPDATE job_queue SET status = 'error', error_text = 'Python no encontrado', finished_at = ${sqlLiteral(now)}, updated_at = ${sqlLiteral(now)} WHERE job_id = ${sqlLiteral(jobRow.job_id)}`)
    _notifyStatusChange(jobRow.job_id)
    return
  }

  const env = getProjectEnv()
  env.NO_PAUSE = '1'
  env.PYTHONPATH = PROJECT_ROOT
  env.PYTHONIOENCODING = 'utf-8'
  env.PUBLICIDAD_JOB_ID = jobRow.job_id
  env.PUBLICIDAD_LOG_FILE = logFile

  // Parse payload and merge env overrides
  let payload = {}
  try { payload = JSON.parse(jobRow.payload_json || '{}') } catch { /* ignore */ }
  if (payload.env && typeof payload.env === 'object') {
    Object.assign(env, payload.env)
  }

  const runnerPayload = JSON.stringify({ ...payload, job_id: jobRow.job_id })
  const args = ['-m', 'core.server.bot_runner', jobRow.action, runnerPayload, '--job-id', jobRow.job_id, '--log-file', logFile]

  let proc
  try {
    proc = spawn(pythonBin, args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', logFd, logFd],
    })
  } catch (err) {
    fs.closeSync(logFd)
    _releaseResource(jobRow.resource_key)
    const now = _nowIso()
    _dbExec(`UPDATE job_queue SET status = 'error', error_text = ${sqlLiteral(err.message)}, finished_at = ${sqlLiteral(now)}, updated_at = ${sqlLiteral(now)} WHERE job_id = ${sqlLiteral(jobRow.job_id)}`)
    _notifyStatusChange(jobRow.job_id)
    return
  }

  const now = _nowIso()
  _dbExec(`UPDATE job_queue SET status = 'running', started_at = ${sqlLiteral(now)}, worker_pid = ${proc.pid}, log_file = ${sqlLiteral(logFile)}, updated_at = ${sqlLiteral(now)} WHERE job_id = ${sqlLiteral(jobRow.job_id)}`)

  activeWorkers.set(jobRow.job_id, { process: proc, jobRow, logFile, logFd })
  _notifyStatusChange(jobRow.job_id)

  proc.on('exit', (code) => {
    try { fs.closeSync(logFd) } catch { /* ignore */ }

    // Copy final log for backward compat with bot_runner_last.log
    if (jobRow.action === 'run_full_cycle') {
      const lastLog = path.join(PROJECT_ROOT, 'logs', 'bot_runner_last.log')
      try { fs.copyFileSync(logFile, lastLog) } catch { /* ignore */ }
    }

    const finalStatus = code === 0 ? 'success' : 'error'
    const errorText = code !== 0 ? `Process exited with code ${code}` : ''
    _finishJob(jobRow.job_id, finalStatus, { exit_code: code }, errorText)

    // Send legacy bot-log-lines event for backward compat
    if (state.mainWindow) {
      state.mainWindow.webContents.send('bot-log-lines', [
        `[INFO] Job ${jobRow.job_id} (${jobRow.action}) finalizo con codigo: ${code}`
      ])
    }
  })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _finishJob(jobId, status, result, errorText) {
  const worker = activeWorkers.get(jobId)
  if (worker) {
    _releaseResource(worker.jobRow.resource_key)
    activeWorkers.delete(jobId)
  }
  const now = _nowIso()
  const resultStr = result ? JSON.stringify(result).replace(/'/g, "''") : '{}'
  const errStr = (errorText || '').replace(/'/g, "''")
  try {
    _dbExec(`UPDATE job_queue SET status = ${sqlLiteral(status)}, finished_at = ${sqlLiteral(now)}, updated_at = ${sqlLiteral(now)}, result_json = '${resultStr}', error_text = '${errStr}' WHERE job_id = ${sqlLiteral(jobId)}`)
  } catch { /* ignore */ }
  _notifyStatusChange(jobId)
}

function _countActive(workerType) {
  let total = 0
  const byResource = new Map()
  for (const [, w] of activeWorkers) {
    if (w.jobRow.worker_type === workerType) {
      total++
      const rk = w.jobRow.resource_key || ''
      byResource.set(rk, (byResource.get(rk) || 0) + 1)
    }
  }
  return { total, byResource }
}

function _getLockedResources(workerType) {
  const keys = []
  for (const [, w] of activeWorkers) {
    if (w.jobRow.worker_type === workerType && w.jobRow.resource_key) {
      keys.push(w.jobRow.resource_key)
    }
  }
  return keys
}

function _isResourceLocked(resourceKey) {
  if (!resourceKey) return false
  const rows = _dbQuery(`SELECT resource_key FROM resource_locks WHERE resource_key = ${sqlLiteral(resourceKey)}`)
  return rows.length > 0
}

function _acquireResource(resourceKey, jobId) {
  if (!resourceKey) return true
  const now = _nowIso()
  const nowTs = Date.now() / 1000
  const expires = new Date((nowTs + 7200) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  try {
    _dbExec(`DELETE FROM resource_locks WHERE expires_at < ${sqlLiteral(now)}`)
    const existing = _dbQuery(`SELECT resource_key FROM resource_locks WHERE resource_key = ${sqlLiteral(resourceKey)}`)
    if (existing.length > 0) return false
    _dbExec(`INSERT INTO resource_locks(resource_key, job_id, acquired_at, expires_at, worker_pid) VALUES (${sqlLiteral(resourceKey)}, ${sqlLiteral(jobId)}, ${sqlLiteral(now)}, ${sqlLiteral(expires)}, 0)`)
    return true
  } catch {
    return false
  }
}

function _releaseResource(resourceKey) {
  if (!resourceKey) return
  try {
    _dbExec(`DELETE FROM resource_locks WHERE resource_key = ${sqlLiteral(resourceKey)}`)
  } catch { /* ignore */ }
}

function _classifyWorkerType(action) {
  const map = { run_full_cycle: 'cdp', generate_video: 'video', generate_reel: 'video', generate_brochure: 'brochure' }
  if (map[action]) return map[action]
  if (action.startsWith('publish_')) return 'publish'
  if (action.includes('campaign')) return 'api'
  return 'api'
}

function _classifyResourceKey(action, payload) {
  const wtype = _classifyWorkerType(action)
  payload = payload || {}
  if (wtype === 'cdp') return `cdp:profile:${payload.profile_name || 'default'}`
  if (wtype === 'video') return 'video:slot'
  if (wtype === 'publish') {
    const platform = action.startsWith('publish_') ? action.replace('publish_', '') : 'unknown'
    return `publish:${platform}`
  }
  return ''
}

function _cleanupOrphanedJobs() {
  const now = _nowIso()
  try {
    const stale = _dbQuery("SELECT job_id, worker_pid FROM job_queue WHERE status IN ('running', 'claimed')")
    for (const row of stale) {
      if (row.worker_pid && !isPidAlive(row.worker_pid)) {
        _dbExec(`UPDATE job_queue SET status = 'error', error_text = 'Orphaned: process died', finished_at = ${sqlLiteral(now)}, updated_at = ${sqlLiteral(now)} WHERE job_id = ${sqlLiteral(row.job_id)}`)
      }
    }
    _dbExec('DELETE FROM resource_locks')
  } catch { /* ignore */ }
}

function _cleanupOldLogs() {
  const logsDir = path.join(PROJECT_ROOT, 'logs', 'jobs')
  if (!fs.existsSync(logsDir)) return
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  try {
    for (const file of fs.readdirSync(logsDir)) {
      const filePath = path.join(logsDir, file)
      const stat = fs.statSync(filePath)
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath)
      }
    }
  } catch { /* ignore */ }
}

function _notifyStatusChange(jobId) {
  if (!state.mainWindow) return
  const detail = getJobDetail(jobId)
  state.mainWindow.webContents.send('job-status-change', detail)
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  start,
  stop,
  shutdown,
  enqueueJob,
  cancelJob,
  listJobs,
  getJobDetail,
  getActiveCount,
  activeWorkers,
}
