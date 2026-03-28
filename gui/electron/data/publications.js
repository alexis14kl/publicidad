/**
 * Publications Data Layer — CRUD para historial de publicaciones
 *
 * Registra cada post publicado en FB/IG con su post_id para poder
 * listar, auditar y eliminar publicaciones desde la UI.
 */

const fs = require('fs')
const path = require('path')
const { runSqliteJson, runSqlite, sqlLiteral } = require('../utils/sqlite')
const { PROJECT_ROOT } = require('../config/project-paths')

const DB_PATH = path.join(PROJECT_ROOT, 'Backend', 'publications.sqlite3')
const SCHEMA_PATH = path.join(PROJECT_ROOT, 'Backend', 'schema_publications.sql')

let _ensured = false

function ensurePublicationsDb() {
  if (_ensured) return DB_PATH
  if (!fs.existsSync(DB_PATH)) {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
    runSqlite(DB_PATH, schema)
  } else {
    // Ensure schema is up to date
    try {
      const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
      runSqlite(DB_PATH, schema)
    } catch { /* table already exists */ }
  }
  _ensured = true
  return DB_PATH
}

/**
 * Inserta un registro de publicación.
 */
function insertPublication({ postId, platform, pageId, pageName, companyName, contentType, message, imageUrl, status }) {
  const db = ensurePublicationsDb()
  const sql = `INSERT INTO publications (post_id, platform, page_id, page_name, company_name, content_type, message, image_url, status)
    VALUES (${sqlLiteral(postId)}, ${sqlLiteral(platform)}, ${sqlLiteral(pageId || '')}, ${sqlLiteral(pageName || '')}, ${sqlLiteral(companyName || '')}, ${sqlLiteral(contentType || 'text')}, ${sqlLiteral(message || '')}, ${sqlLiteral(imageUrl || '')}, ${sqlLiteral(status || 'published')});`
  runSqlite(db, sql)

  // Return the inserted row
  const rows = runSqliteJson(db, `SELECT * FROM publications WHERE id = (SELECT MAX(id) FROM publications);`)
  return rows[0] || null
}

/**
 * Marca una publicación como eliminada.
 */
function markPublicationDeleted(postId) {
  const db = ensurePublicationsDb()
  runSqlite(db, `UPDATE publications SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE post_id = ${sqlLiteral(postId)};`)
}

/**
 * Marca una publicación como fallida.
 */
function markPublicationFailed(postId) {
  const db = ensurePublicationsDb()
  runSqlite(db, `UPDATE publications SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE post_id = ${sqlLiteral(postId)};`)
}

/**
 * Lista publicaciones con filtros opcionales.
 */
function listPublications({ companyName, platform, status, fromDate, toDate, limit, offset } = {}) {
  const db = ensurePublicationsDb()
  const conditions = []

  if (companyName) conditions.push(`company_name = ${sqlLiteral(companyName)}`)
  if (platform) conditions.push(`platform = ${sqlLiteral(platform)}`)
  if (status) conditions.push(`status = ${sqlLiteral(status)}`)
  if (fromDate) conditions.push(`published_at >= ${sqlLiteral(fromDate)}`)
  if (toDate) conditions.push(`published_at <= ${sqlLiteral(toDate)}`)

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limitClause = limit ? `LIMIT ${Number(limit)}` : 'LIMIT 200'
  const offsetClause = offset ? `OFFSET ${Number(offset)}` : ''

  return runSqliteJson(db, `SELECT * FROM publications ${where} ORDER BY published_at DESC ${limitClause} ${offsetClause};`)
}

/**
 * Obtiene una publicación por post_id.
 */
function getPublicationByPostId(postId) {
  const db = ensurePublicationsDb()
  const rows = runSqliteJson(db, `SELECT * FROM publications WHERE post_id = ${sqlLiteral(postId)} LIMIT 1;`)
  return rows[0] || null
}

/**
 * Lista todas las publicaciones activas (status = 'published').
 */
function listActivePublications() {
  const db = ensurePublicationsDb()
  return runSqliteJson(db, `SELECT * FROM publications WHERE status = 'published';`)
}

module.exports = {
  ensurePublicationsDb,
  insertPublication,
  markPublicationDeleted,
  markPublicationFailed,
  listPublications,
  listActivePublications,
  getPublicationByPostId,
}
