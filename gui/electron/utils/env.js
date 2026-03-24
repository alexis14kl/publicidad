const fs = require('fs')
const path = require('path')
const { PROJECT_ROOT } = require('../config/project-paths')

function parseEnvFile(filePath) {
  const env = {}
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.substring(0, eqIndex).trim()
      let value = trimmed.substring(eqIndex + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      env[key] = value
    }
  } catch {
    // Ignore missing env file and return the partial map.
  }
  return env
}

// Cache parsed .env — only re-read if file changed
let _envCache = null
let _envMtime = 0

function getProjectEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env')
  let currentMtime = 0
  try { currentMtime = fs.statSync(envPath).mtimeMs } catch { /* no .env */ }

  if (!_envCache || currentMtime !== _envMtime) {
    _envCache = parseEnvFile(envPath)
    _envMtime = currentMtime
  }

  const env = { ...process.env, ..._envCache }
  if (process.platform === 'darwin') {
    const rawPath = String(env.PATH || '')
    const parts = rawPath.split(':').filter(Boolean)
    for (const extra of ['/usr/local/bin', '/opt/homebrew/bin']) {
      if (!parts.includes(extra)) parts.unshift(extra)
    }
    env.PATH = parts.join(':')

    // Fix SSL certificates for Python on macOS
    if (!env.SSL_CERT_FILE) {
      const certPath = path.join(PROJECT_ROOT, 'venv', 'lib', 'python3.12', 'site-packages', 'certifi', 'cacert.pem')
      if (fs.existsSync(certPath)) {
        env.SSL_CERT_FILE = certPath
      }
    }
  }
  return env
}

module.exports = {
  getProjectEnv,
  parseEnvFile,
}
