const fs = require('fs')
const path = require('path')
const { PROJECT_ROOT } = require('../config/project-paths')

function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeUiText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildAliasPatterns(aliases = []) {
  const normalizedAliases = [...new Set(
    aliases
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )]
  if (normalizedAliases.length === 0) {
    return {
      aliases: [],
      exactPattern: /$^/,
      loosePattern: /$^/,
    }
  }
  const escaped = normalizedAliases.map(escapeRegex)
  return {
    aliases: normalizedAliases,
    exactPattern: new RegExp(`^(?:${escaped.join('|')})$`, 'i'),
    loosePattern: new RegExp(escaped.join('|'), 'i'),
  }
}

function ensureAbsoluteUrl(value, fallback = 'https://noyecode.com') {
  let raw = String(value || '').trim()
  if (!raw) {
    raw = fallback
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw.replace(/^\/+/, '')}`
  }
  return raw
}

function buildPrivacyPolicyUrl(baseUrl = '') {
  const { getProjectEnv } = require('./env')
  const absolute = ensureAbsoluteUrl(baseUrl || getProjectEnv().BUSINESS_WEBSITE || 'https://noyecode.com')
  try {
    return new URL('/privacidad', absolute).toString()
  } catch {
    return `${absolute.replace(/\/+$/, '')}/privacidad`
  }
}

function normalizeBudgetForUi(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) {
    throw new Error('El presupuesto maximo de la GUI no es valido para rellenar Ads Manager.')
  }
  return String(Number(digits))
}

function parseGuiDateParts(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    throw new Error(`La fecha "${value}" no tiene el formato esperado YYYY-MM-DD.`)
  }
  return {
    year: match[1],
    month: match[2],
    day: match[3],
  }
}

function formatGuiDateForSlash(value) {
  const { year, month, day } = parseGuiDateParts(value)
  return `${day}/${month}/${year}`
}

function formatGuiDateForLong(value) {
  const { year, month, day } = parseGuiDateParts(value)
  const date = new Date(`${year}-${month}-${day}T12:00:00-05:00`)
  return date.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getDefaultLeadFormFieldLabels() {
  return ['Nombre completo', 'Correo electronico', 'Telefono movil']
}

function getDefaultLeadFormRequiredKeys() {
  return ['full_name', 'email', 'phone_number']
}

function normalizeCompanyKey(name) {
  return String(name || '').trim().toLowerCase()
}

function resolveCompanyLogoUrl(logoPath) {
  const raw = String(logoPath || '').trim()
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('data:')) return raw
  const absolutePath = path.isAbsolute(raw) ? raw : path.join(PROJECT_ROOT, raw)
  if (!fs.existsSync(absolutePath)) return null
  // Convertir a data URL base64 para que funcione con Electron CSP
  try {
    const ext = path.extname(absolutePath).toLowerCase().replace('.', '')
    const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : 'image/png'
    const base64 = fs.readFileSync(absolutePath).toString('base64')
    return `data:${mime};base64,${base64}`
  } catch {
    return null
  }
}

function persistEnvConfig(config = {}) {
  const envPath = path.join(PROJECT_ROOT, '.env')
  let content = ''
  try {
    content = fs.readFileSync(envPath, 'utf-8')
  } catch {
    // file may not exist yet
  }

  const updatedKeys = new Set()
  const lines = content.split('\n')
  const newLines = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) return line
    const key = trimmed.substring(0, eqIndex).trim()
    if (key in config) {
      updatedKeys.add(key)
      return `${key}=${config[key]}`
    }
    return line
  })

  for (const [key, value] of Object.entries(config)) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${value}`)
    }
  }

  fs.writeFileSync(envPath, newLines.join('\n'), 'utf-8')
  return { success: true }
}

module.exports = {
  readJsonFile,
  sleep,
  normalizeUiText,
  escapeRegex,
  buildAliasPatterns,
  ensureAbsoluteUrl,
  buildPrivacyPolicyUrl,
  normalizeBudgetForUi,
  parseGuiDateParts,
  formatGuiDateForSlash,
  formatGuiDateForLong,
  escapeHtml,
  getDefaultLeadFormFieldLabels,
  getDefaultLeadFormRequiredKeys,
  normalizeCompanyKey,
  resolveCompanyLogoUrl,
  persistEnvConfig,
}
