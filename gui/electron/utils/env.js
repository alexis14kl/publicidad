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

function getProjectEnv() {
  const env = { ...process.env, ...parseEnvFile(path.join(PROJECT_ROOT, '.env')) }
  if (process.platform === 'darwin') {
    const rawPath = String(env.PATH || '')
    const parts = rawPath.split(':').filter(Boolean)
    for (const extra of ['/usr/local/bin', '/opt/homebrew/bin']) {
      if (!parts.includes(extra)) parts.unshift(extra)
    }
    env.PATH = parts.join(':')
  }
  return env
}

module.exports = {
  getProjectEnv,
  parseEnvFile,
}
