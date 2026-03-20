const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const { PROJECT_ROOT } = require('../config/project-paths')
const { COMPANY_PLATFORM_CONFIG, COMPANY_PLATFORMS } = require('../config/company-platforms')
const { sqlLiteral, runSqliteJson, runSqlite, SQLITE3_BIN } = require('../utils/sqlite')
const { normalizeCompanyKey, resolveCompanyLogoUrl } = require('../utils/helpers')

const COLOR_COLUMNS = [
  { name: 'color_primario', default: '#3469ED' },
  { name: 'color_cta',      default: '#fd9102' },
  { name: 'color_acento',   default: '#00bcd4' },
  { name: 'color_checks',   default: '#28a745' },
  { name: 'color_fondo',    default: '#f0f0f5' },
]

function getCompanyDbPath(platform) {
  const normalized = String(platform || '').trim().toLowerCase()
  if (!COMPANY_PLATFORMS.has(normalized)) {
    throw new Error(`Plataforma no soportada: ${platform}`)
  }
  return path.join(PROJECT_ROOT, 'Backend', `${normalized}.sqlite3`)
}

function getCompanyPlatformConfig(platform) {
  const normalized = String(platform || '').trim().toLowerCase()
  const config = COMPANY_PLATFORM_CONFIG[normalized]
  if (!config) {
    throw new Error(`Plataforma no soportada: ${platform}`)
  }
  return config
}

function companyTableHasColumn(dbPath, columnName) {
  const target = String(columnName || '').trim().toLowerCase()
  if (!target) return false
  const columns = runSqliteJson(dbPath, 'PRAGMA table_info(empresas);')
  return columns.some((column) => String(column?.name || '').trim().toLowerCase() === target)
}

function platformTableHasColumn(dbPath, platformConfig, columnName) {
  const target = String(columnName || '').trim().toLowerCase()
  if (!target) return false
  const columns = runSqliteJson(dbPath, `PRAGMA table_info(${platformConfig.table});`)
  return columns.some((column) => String(column?.name || '').trim().toLowerCase() === target)
}

function ensureCompanyPlatformSchema(dbPath, platformConfig) {
  const statements = ['PRAGMA foreign_keys=ON;']

  if (!platformTableHasColumn(dbPath, platformConfig, 'account_index')) {
    statements.push(`ALTER TABLE ${platformConfig.table} ADD COLUMN account_index INTEGER NOT NULL DEFAULT 1;`)
  }
  if (!platformTableHasColumn(dbPath, platformConfig, 'account_label')) {
    statements.push(`ALTER TABLE ${platformConfig.table} ADD COLUMN account_label TEXT;`)
  }
  if (!platformTableHasColumn(dbPath, platformConfig, 'is_primary')) {
    statements.push(`ALTER TABLE ${platformConfig.table} ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;`)
  }
  if (platformConfig.table === 'facebook_form' && !platformTableHasColumn(dbPath, platformConfig, 'page_id')) {
    statements.push(`ALTER TABLE ${platformConfig.table} ADD COLUMN page_id TEXT;`)
  }
  if (platformConfig.table === 'instagram_form' && !platformTableHasColumn(dbPath, platformConfig, 'account_id')) {
    statements.push(`ALTER TABLE ${platformConfig.table} ADD COLUMN account_id TEXT;`)
  }

  statements.push(`UPDATE ${platformConfig.table} SET account_index = COALESCE(account_index, 1);`)
  statements.push(`UPDATE ${platformConfig.table} SET account_label = COALESCE(NULLIF(TRIM(account_label), ''), 'Cuenta ' || account_index);`)
  statements.push(`UPDATE ${platformConfig.table} SET is_primary = CASE WHEN account_index = 1 THEN 1 ELSE COALESCE(is_primary, 0) END;`)
  statements.push(`DROP INDEX IF EXISTS idx_${platformConfig.table}_empresa_unica;`)
  statements.push(`CREATE INDEX IF NOT EXISTS idx_${platformConfig.table}_empresa_id ON ${platformConfig.table}(empresa_id);`)
  statements.push(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${platformConfig.table}_empresa_cuenta_unica ON ${platformConfig.table}(empresa_id, account_index);`)

  runSqlite(dbPath, statements.join('\n'))
}

function ensureCompanyColorColumns(dbPath) {
  const statements = []
  for (const col of COLOR_COLUMNS) {
    if (!companyTableHasColumn(dbPath, col.name)) {
      statements.push(`ALTER TABLE empresas ADD COLUMN ${col.name} TEXT DEFAULT '${col.default}';`)
    }
  }
  if (statements.length > 0) runSqlite(dbPath, statements.join('\n'))
}

function migrateLegacyCompanyPlatformData(dbPath, platformConfig) {
  try {
    const hasLegacyToken = companyTableHasColumn(dbPath, 'token')
    if (!hasLegacyToken) return

    runSqlite(
      dbPath,
      `
      PRAGMA foreign_keys=ON;
      INSERT INTO ${platformConfig.table} (
        empresa_id,
        account_index,
        account_label,
        token,
        activo,
        is_primary,
        created_at,
        updated_at
      )
      SELECT
        e.id,
        1,
        'Cuenta principal',
        e.token,
        COALESCE(e.activo, 1),
        1,
        COALESCE(e.created_at, CURRENT_TIMESTAMP),
        COALESCE(e.updated_at, CURRENT_TIMESTAMP)
      FROM empresas e
      WHERE TRIM(COALESCE(e.token, '')) <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM ${platformConfig.table} p
          WHERE p.empresa_id = e.id
        );
      `
    )
  } catch {
    // Ignore legacy migration issues and keep runtime path available.
  }
}

// Cache: only run schema migrations once per platform per session
const _ensuredPlatforms = new Set()

function ensureCompanyDb(platform) {
  const platformConfig = getCompanyPlatformConfig(platform)
  const dbPath = getCompanyDbPath(platform)

  // Skip migrations if already ensured this session
  if (_ensuredPlatforms.has(platform)) return dbPath

  const schemaPath = path.join(PROJECT_ROOT, 'Backend', 'schema_empresas_redes.sql')
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8')
  const platformSchemaPath = path.join(PROJECT_ROOT, 'Backend', platformConfig.schemaFile)
  const platformSchemaSql = fs.readFileSync(platformSchemaPath, 'utf-8')
  execFileSync(SQLITE3_BIN, [dbPath], {
    input: `${schemaSql}\n${platformSchemaSql}`,
    encoding: 'utf-8',
  })
  ensureCompanyPlatformSchema(dbPath, platformConfig)
  ensureCompanyColorColumns(dbPath)
  migrateLegacyCompanyPlatformData(dbPath, platformConfig)

  _ensuredPlatforms.add(platform)
  return dbPath
}

function getEmptyCompanyAggregation(row = {}) {
  return {
    id: normalizeCompanyKey(row.nombre),
    nombre: String(row.nombre || '').trim(),
    logo: row.logo || null,
    logo_url: resolveCompanyLogoUrl(row.logo),
    telefono: row.telefono || null,
    correo: row.correo || null,
    sitio_web: row.sitio_web || null,
    direccion: row.direccion || null,
    descripcion: row.descripcion || null,
    color_primario: row.color_primario || '#3469ED',
    color_cta: row.color_cta || '#fd9102',
    color_acento: row.color_acento || '#00bcd4',
    color_checks: row.color_checks || '#28a745',
    color_fondo: row.color_fondo || '#f0f0f5',
    activo: Number(row.empresa_activa ?? row.activo ?? 1),
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
    platforms: [],
  }
}

function aggregateCompanyRows(rowsByPlatform = {}) {
  const companies = new Map()

  for (const [platform, rows] of Object.entries(rowsByPlatform)) {
    const platformConfig = getCompanyPlatformConfig(platform)
    for (const row of rows || []) {
      const key = normalizeCompanyKey(row.nombre)
      if (!key) continue

      if (!companies.has(key)) {
        companies.set(key, getEmptyCompanyAggregation(row))
      }

      const company = companies.get(key)
      const platformRecord = company.platforms.find((entry) => entry.platform === platform)
      const account = {
        red_id: row.red_id,
        account_index: Number(row.account_index || 1),
        account_label: String(row.account_label || `Cuenta ${row.account_index || 1}`),
        token: String(row.token || ''),
        page_id: String(row.page_id || ''),
        account_id: String(row.account_id || ''),
        activo: Number(row.plataforma_activa ?? row.activo ?? 1),
        is_primary: Number(row.is_primary ?? 0),
      }

      if (platformRecord) {
        platformRecord.accounts.push(account)
      } else {
        company.platforms.push({
          platform,
          label: platformConfig.label,
          dbFile: platformConfig.dbFile,
          config_env_key: platformConfig.tokenEnvKey,
          accounts: [account],
        })
      }

      if (!company.updated_at || String(row.updated_at || '') > String(company.updated_at || '')) {
        company.updated_at = row.updated_at || company.updated_at
      }
      if (!company.created_at || String(row.created_at || '') < String(company.created_at || company.created_at || '9999')) {
        company.created_at = row.created_at || company.created_at
      }
    }
  }

  return [...companies.values()]
    .map((company) => ({
      ...company,
      platforms: company.platforms
        .map((platformRecord) => ({
          ...platformRecord,
          accounts: [...platformRecord.accounts].sort((a, b) => a.account_index - b.account_index),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
}

function findCompanyIdByName(dbPath, nombre) {
  const rows = runSqliteJson(
    dbPath,
    `
    SELECT id
    FROM empresas
    WHERE lower(trim(nombre)) = lower(trim(${sqlLiteral(nombre)}))
    ORDER BY id DESC
    LIMIT 1;
    `
  )
  return rows[0]?.id || null
}

function fetchCompanyRowsForPlatform(platform) {
  const dbPath = ensureCompanyDb(platform)
  const platformConfig = getCompanyPlatformConfig(platform)
  return runSqliteJson(
    dbPath,
    `
    SELECT
      e.id AS empresa_id,
      p.id AS red_id,
      e.nombre AS nombre,
      e.logo AS logo,
      e.telefono AS telefono,
      e.correo AS correo,
      e.sitio_web AS sitio_web,
      e.direccion AS direccion,
      e.descripcion AS descripcion,
      e.color_primario AS color_primario,
      e.color_cta AS color_cta,
      e.color_acento AS color_acento,
      e.color_checks AS color_checks,
      e.color_fondo AS color_fondo,
      e.activo AS empresa_activa,
      e.created_at AS created_at,
      e.updated_at AS updated_at,
      p.account_index AS account_index,
      p.account_label AS account_label,
      p.token AS token,
      ${platform === 'facebook' ? 'p.page_id AS page_id,' : "'' AS page_id,"}
      ${platform === 'instagram' ? 'p.account_id AS account_id,' : "'' AS account_id,"}
      p.activo AS plataforma_activa,
      p.is_primary AS is_primary
    FROM ${platformConfig.table} p
    INNER JOIN empresas e ON e.id = p.empresa_id
    ORDER BY e.nombre COLLATE NOCASE ASC, p.account_index ASC;
    `
  )
}

module.exports = {
  COLOR_COLUMNS,
  ensureCompanyDb,
  ensureCompanyPlatformSchema,
  ensureCompanyColorColumns,
  companyTableHasColumn,
  platformTableHasColumn,
  migrateLegacyCompanyPlatformData,
  getCompanyDbPath,
  getCompanyPlatformConfig,
  getEmptyCompanyAggregation,
  aggregateCompanyRows,
  findCompanyIdByName,
  fetchCompanyRowsForPlatform,
}
