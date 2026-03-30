/**
 * TikTok API — HTTP request wrapper
 *
 * Patron equivalente a facebook/api.js pero adaptado a TikTok:
 * - Base URL: https://open.tiktokapis.com
 * - Auth: header Authorization: Bearer {token}
 * - Content-Type: application/json (no form-urlencoded)
 * - Error shape: { error: { code, message, log_id } }
 */

const https = require('https')

const TIKTOK_API_BASE = 'https://open.tiktokapis.com'
const TIKTOK_UPLOAD_BASE = 'https://open-upload.tiktokapis.com'
const REQUEST_TIMEOUT_MS = 30000

/**
 * Ejecuta una peticion HTTP a la API de TikTok.
 *
 * @param {string} method - GET o POST
 * @param {string} path - Path relativo (ej: '/v2/post/publish/video/init/')
 * @param {Object} [body] - Body JSON para POST, query params para GET
 * @param {string} [token] - Access token (Bearer auth)
 * @param {Object} [options]
 * @param {string} [options.baseUrl] - Override base URL (para upload server)
 * @param {number} [options.timeout] - Override timeout ms
 * @returns {Promise<Object>} - Parsed JSON response
 */
function tiktokApiRequest(method, path, body = {}, token = '', options = {}) {
  const baseUrl = options.baseUrl || TIKTOK_API_BASE
  const timeout = options.timeout || REQUEST_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`)
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'noyecode-bot/1.0',
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    let requestBody = null

    if (method === 'GET') {
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value))
        }
      }
    } else {
      requestBody = JSON.stringify(body)
      headers['Content-Type'] = 'application/json; charset=UTF-8'
      headers['Content-Length'] = Buffer.byteLength(requestBody)
    }

    const request = https.request(
      url,
      { method, timeout, headers },
      (response) => {
        let raw = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => { raw += chunk })
        response.on('end', () => {
          try {
            const data = raw ? JSON.parse(raw) : {}

            // TikTok success: error.code === 'ok' o HTTP 2xx sin error
            const errorCode = data?.error?.code
            if (response.statusCode >= 200 && response.statusCode < 300 && (!errorCode || errorCode === 'ok')) {
              resolve(data)
              return
            }

            // TikTok error format
            const errorMessage = [
              data?.error?.message || `HTTP ${response.statusCode}`,
              errorCode ? `code=${errorCode}` : '',
              data?.error?.log_id ? `log_id=${data.error.log_id}` : '',
              `path=${path}`,
            ].filter(Boolean).join(' | ')
            reject(new Error(errorMessage))
          } catch (parseError) {
            reject(new Error(`Respuesta invalida de TikTok: ${parseError.message}`))
          }
        })
      }
    )

    request.on('timeout', () => {
      request.destroy(new Error('TikTok API timeout'))
    })
    request.on('error', reject)
    if (requestBody) {
      request.write(requestBody)
    }
    request.end()
  })
}

/**
 * POST con content-type application/x-www-form-urlencoded
 * Usado solo para OAuth token exchange (no para Content API).
 */
function tiktokFormRequest(path, params = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${TIKTOK_API_BASE}${path}`)
    const form = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        form.set(key, String(value))
      }
    }
    const body = form.toString()

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      Accept: 'application/json',
    }

    const request = https.request(
      url,
      { method: 'POST', timeout: REQUEST_TIMEOUT_MS, headers },
      (response) => {
        let raw = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => { raw += chunk })
        response.on('end', () => {
          try {
            const data = raw ? JSON.parse(raw) : {}
            if (response.statusCode >= 200 && response.statusCode < 300 && !data.error) {
              resolve(data)
              return
            }
            const errorMessage = data?.error_description || data?.error || `HTTP ${response.statusCode}`
            reject(new Error(String(errorMessage)))
          } catch (parseError) {
            reject(new Error(`Respuesta invalida de TikTok OAuth: ${parseError.message}`))
          }
        })
      }
    )

    request.on('timeout', () => { request.destroy(new Error('TikTok OAuth timeout')) })
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

module.exports = {
  tiktokApiRequest,
  tiktokFormRequest,
  TIKTOK_API_BASE,
  TIKTOK_UPLOAD_BASE,
}
