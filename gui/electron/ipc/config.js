const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { PROJECT_ROOT } = require('../config/project-paths')
const { parseEnvFile, getProjectEnv } = require('../utils/env')
const { persistEnvConfig, readJsonFile } = require('../utils/helpers')
const { findPython } = require('../utils/process')

function registerConfigHandlers(ipcMain) {
  ipcMain.handle('get-env-config', async () => {
    return parseEnvFile(path.join(PROJECT_ROOT, '.env'))
  })

  // Cache preflight result in temp file — only run once per session
  const preflightCachePath = path.join(require('os').tmpdir(), 'noyecode_preflight_cache.json')
  const PREFLIGHT_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

  ipcMain.handle('run-preflight', async (_event, force = false) => {
    // Check cache first (skip if force=true)
    if (!force) {
      try {
        if (fs.existsSync(preflightCachePath)) {
          const cached = JSON.parse(fs.readFileSync(preflightCachePath, 'utf-8'))
          const age = Date.now() - (cached._timestamp || 0)
          if (age < PREFLIGHT_TTL_MS && cached.ok === true) {
            return cached
          }
        }
      } catch { /* cache corrupted, re-run */ }
    }

    const pythonBin = findPython()
    if (!pythonBin) {
      return {
        ok: false,
        checks: [{ name: 'Python', required: '>= 3.10', current: null, ok: false, fix: 'Instala Python 3.10+ desde https://python.org' }],
      }
    }
    const args = ['-m', 'cfg.preflight', '--json']
    if (force) args.push('--force')
    return new Promise((resolve) => {
      const child = spawn(pythonBin, args, {
        cwd: PROJECT_ROOT,
        env: getProjectEnv(),
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => { stdout += d.toString() })
      child.stderr.on('data', (d) => { stderr += d.toString() })
      child.on('close', (code) => {
        try {
          const result = JSON.parse(stdout)
          // Save to cache if OK
          try {
            result._timestamp = Date.now()
            fs.writeFileSync(preflightCachePath, JSON.stringify(result), 'utf-8')
          } catch { /* ignore cache write errors */ }
          resolve(result)
        } catch {
          resolve({
            ok: code === 0,
            checks: [{ name: 'Preflight', required: 'ejecutable', current: code === 0 ? 'ok' : `error (code ${code})`, ok: code === 0, fix: stderr || 'Error ejecutando preflight' }],
          })
        }
      })
      child.on('error', (err) => {
        resolve({
          ok: false,
          checks: [{ name: 'Python', required: '>= 3.10', current: null, ok: false, fix: `Error: ${err.message}` }],
        })
      })
    })
  })

  ipcMain.handle('reset-bot-state', async () => {
    const stateFiles = [
      '.bot_runner.lock',
      '.account_rotation_state.json',
      '.job_poller_state.json',
      '.prompt_last_send.json',
      '.service_rotation_state.json',
    ]
    const logFiles = [
      path.join('logs', 'bot_runner_last.log'),
      path.join('logs', 'job_poller.log'),
    ]
    const memoryFiles = [
      path.join('memory', 'profile', 'memory_profile_change.json'),
    ]

    const deleted = []
    const allFiles = [...stateFiles, ...logFiles, ...memoryFiles]

    for (const file of allFiles) {
      const fullPath = path.join(PROJECT_ROOT, file)
      try {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath)
          deleted.push(file)
        }
      } catch { /* ignore locked files */ }
    }

    return { success: true, deleted }
  })

  ipcMain.handle('save-env-config', async (_event, config) => {
    try {
      return persistEnvConfig(config)
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerConfigHandlers }
