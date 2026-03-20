const { exec, execSync } = require('child_process')
const { sleep } = require('./helpers')

// Cache Python binary — only search once per session
let _cachedPythonBin = undefined

function findPython() {
  if (_cachedPythonBin !== undefined) return _cachedPythonBin

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
  _cachedPythonBin = null
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
