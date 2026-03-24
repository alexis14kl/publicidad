const fs = require('fs')
const path = require('path')
const { exec, execSync } = require('child_process')
const { sleep } = require('./helpers')
const { PROJECT_ROOT } = require('../config/project-paths')

// Cache Python binary — only search once per session
let _cachedPythonBin = undefined

function findPython() {
  // Only cache positive results — retry on failure
  if (_cachedPythonBin) return _cachedPythonBin

  // 1. Prefer the project's virtual environment Python
  const venvBin = process.platform === 'win32' ? 'Scripts' : 'bin'
  const venvPython = process.platform === 'win32'
    ? path.join(PROJECT_ROOT, 'venv', venvBin, 'python.exe')
    : path.join(PROJECT_ROOT, 'venv', venvBin, 'python3')

  if (fs.existsSync(venvPython)) {
    _cachedPythonBin = venvPython
    return venvPython
  }

  // 2. Fallback to system Python
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python']

  for (const name of candidates) {
    try {
      const result = execSync(
        process.platform === 'win32' ? `where ${name}` : `which ${name}`,
        { timeout: 3000, encoding: 'utf-8' }
      )
      if (result.trim()) {
        _cachedPythonBin = name
        return name
      }
    } catch { /* not found */ }
  }
  return null
}

function killProcessTree(pid) {
  if (!pid || pid <= 0) return
  try {
    if (process.platform === 'win32') {
      exec(`taskkill /F /T /PID ${pid}`)
    } else {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        exec(`kill -9 ${pid}`)
      }
    }
  } catch { /* ignore */ }
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function stopPidBestEffort(pid) {
  if (!pid || pid <= 0) return

  if (process.platform === 'darwin') {
    try {
      process.kill(pid, 'SIGINT')
    } catch {
      // fall back to hard kill below
    }
    await sleep(1200)
    if (!isPidAlive(pid)) return
  }

  killProcessTree(pid)
}

module.exports = {
  findPython,
  killProcessTree,
  isPidAlive,
  stopPidBestEffort,
}
