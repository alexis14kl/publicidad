/**
 * OAuth Manager — Servidor HTTPS local genérico para OAuth callbacks
 *
 * Reutilizable por cualquier plataforma (Facebook, TikTok, LinkedIn, etc.)
 * Genera un certificado autofirmado en memoria, abre el navegador del sistema,
 * y captura el ?code= del callback.
 */

const { shell } = require('electron')
const https = require('https')

const DEFAULT_PORT = 19284
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Genera un certificado SSL autofirmado para localhost via openssl.
 */
function generateSelfSignedCert() {
  const { execSync } = require('child_process')
  const os = require('os')
  const path = require('path')
  const fs = require('fs')

  const tmpDir = os.tmpdir()
  const keyPath = path.join(tmpDir, `noyecode-oauth-key-${Date.now()}.pem`)
  const certPath = path.join(tmpDir, `noyecode-oauth-cert-${Date.now()}.pem`)

  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=localhost" 2>/dev/null`,
      { timeout: 5000 }
    )
    const key = fs.readFileSync(keyPath, 'utf8')
    const cert = fs.readFileSync(certPath, 'utf8')
    try { fs.unlinkSync(keyPath) } catch { /* ignore */ }
    try { fs.unlinkSync(certPath) } catch { /* ignore */ }
    return { key, cert }
  } catch {
    try { fs.unlinkSync(keyPath) } catch { /* ignore */ }
    try { fs.unlinkSync(certPath) } catch { /* ignore */ }
    throw new Error('No se pudo generar el certificado SSL. Asegurate de tener openssl instalado.')
  }
}

/**
 * Ejecuta un flujo OAuth completo:
 * 1. Levanta servidor HTTPS local
 * 2. Abre el navegador del sistema con la URL de OAuth
 * 3. Captura el code del callback
 * 4. Cierra el servidor
 *
 * @param {Object} options
 * @param {string} options.oauthUrl - URL completa del dialog de OAuth
 * @param {string} options.callbackPath - Path del callback (ej: '/auth/facebook/callback')
 * @param {number} [options.port] - Puerto del servidor local (default: 19284)
 * @param {number} [options.timeoutMs] - Timeout en ms (default: 5 min)
 * @returns {Promise<{ code: string }>}
 */
async function startOAuthFlow({ oauthUrl, callbackPath, port = DEFAULT_PORT, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const sslCert = generateSelfSignedCert()

  return new Promise((resolve, reject) => {
    let resolved = false
    let server = null

    function finish(err, result) {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      if (server) {
        try { server.close() } catch { /* ignore */ }
      }
      if (err) reject(err)
      else resolve(result)
    }

    const timeout = setTimeout(() => {
      finish(new Error('Tiempo de espera agotado. Vuelve a intentar.'))
    }, timeoutMs)

    server = https.createServer(sslCert, (req, res) => {
      if (!req.url.startsWith(callbackPath)) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const reqUrl = new URL(req.url, `https://localhost:${port}`)
      const code = reqUrl.searchParams.get('code')
      const errorParam = reqUrl.searchParams.get('error')

      if (errorParam) {
        const errorDesc = reqUrl.searchParams.get('error_description') || errorParam
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(buildHtmlPage('Error', `Autorizacion rechazada: ${errorDesc}`, false))
        finish(new Error(errorDesc))
        return
      }

      if (!code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(buildHtmlPage('Error', 'No se recibio el codigo de autorizacion.', false))
        finish(new Error('No se recibio el codigo de autorizacion.'))
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(buildHtmlPage('Conectado', 'Cuenta conectada exitosamente. Puedes cerrar esta ventana y volver a la app.', true))
      finish(null, { code })
    })

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        finish(new Error(`El puerto ${port} esta en uso. Cierra la aplicacion que lo ocupa e intenta de nuevo.`))
      } else {
        finish(new Error(`Error al iniciar servidor OAuth: ${err.message}`))
      }
    })

    server.listen(port, '127.0.0.1', () => {
      console.log(`[OAuthManager] Servidor HTTPS escuchando en puerto ${port}`)
      shell.openExternal(oauthUrl)
    })
  })
}

/**
 * Construye la redirect URI para un puerto y path dados.
 */
function buildRedirectUri(port, callbackPath) {
  return `https://localhost:${port}${callbackPath}`
}

function buildHtmlPage(title, message, success) {
  const color = success ? '#10b981' : '#ef4444'
  const icon = success ? '&#10003;' : '&#10007;'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title} — NoyeCode</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; display: flex;
    align-items: center; justify-content: center; min-height: 100vh;
    margin: 0; background: #0f0f14; color: #fff; }
  .card { text-align: center; padding: 48px; }
  .icon { font-size: 64px; color: ${color}; margin-bottom: 16px; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  p { color: #9ca3af; font-size: 14px; }
</style></head>
<body><div class="card">
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p>${message}</p>
</div></body></html>`
}

module.exports = {
  startOAuthFlow,
  buildRedirectUri,
  DEFAULT_PORT,
}
