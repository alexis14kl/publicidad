const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { PROJECT_ROOT } = require('../config/project-paths')

function findSqlite3() {
  if (process.platform === 'win32') {
    const bundled = path.join(PROJECT_ROOT, 'scripts', 'bin', 'sqlite3.exe')
    if (fs.existsSync(bundled)) return bundled
  }
  return 'sqlite3'
}

const SQLITE3_BIN = findSqlite3()

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  return `'${String(value).replace(/'/g, "''")}'`
}

function runSqliteJson(dbPath, sql) {
  const stdout = execFileSync(SQLITE3_BIN, ['-json', dbPath, sql], {
    encoding: 'utf-8',
  })
  const trimmed = String(stdout || '').trim()
  if (!trimmed) return []
  return JSON.parse(trimmed)
}

function runSqlite(dbPath, sql) {
  return execFileSync(SQLITE3_BIN, [dbPath], {
    input: sql,
    encoding: 'utf-8',
  })
}

module.exports = {
  SQLITE3_BIN,
  sqlLiteral,
  runSqliteJson,
  runSqlite,
}
