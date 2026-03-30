/**
 * IPC Handlers — Meta Marketing API (OAuth, Tokens, Campaign Pipeline, Page Posts)
 *
 * Canales registrados:
 *   meta-get-app-token           → App Access Token (server-to-server)
 *   meta-get-oauth-url           → URL de login OAuth
 *   meta-exchange-code           → Intercambiar code por short-lived token
 *   meta-exchange-long-lived     → Extender a long-lived token (60 dias)
 *   meta-get-page-tokens         → Listar paginas + Page Tokens
 *   meta-debug-token             → Inspeccionar un token
 *   meta-upload-ad-image         → Subir imagen al ad account
 *   meta-create-leadgen-form     → Crear formulario de leads
 *   meta-create-campaign         → Crear campana
 *   meta-create-adset            → Crear ad set
 *   meta-create-ad-creative      → Crear ad creative
 *   meta-create-ad               → Crear anuncio
 *   meta-activate-campaign       → Activar campana (PAUSED → ACTIVE)
 *   meta-execute-lead-pipeline   → Pipeline completo (6 pasos)
 *   meta-publish-page-post       → Publicar post en pagina
 *   meta-publish-page-photo      → Publicar foto en pagina
 */

const {
  getAppAccessToken,
  getOAuthLoginUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getPageAccessTokens,
  debugToken,
  uploadAdImage,
  createLeadgenForm,
  createCampaign,
  createAdSet,
  createAdCreative,
  createAd,
  activateCampaign,
  executeLeadCampaignPipeline,
  publishPagePost,
  publishPagePhoto,
} = require('../facebook/meta-marketing-api')
/**
 * Descarga un archivo desde una URL a disco.
 */
function downloadFile(url, destPath) {
  const fs = require('fs')
  const mod = url.startsWith('https') ? require('https') : require('http')
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(destPath)
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject)
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    }).on('error', (err) => {
      fs.unlink(destPath, () => {})
      reject(err)
    })
  })
}

// ── OAuth providers por plataforma ────────────────────────────────────────
const OAUTH_PROVIDERS = {
  facebook: () => require('../oauth/facebook-oauth').startFacebookOAuth(),
  tiktok: () => require('../oauth/tiktok-oauth').startTikTokOAuth(),
  // linkedin: () => require('../oauth/linkedin-oauth').startLinkedInOAuth(),
}

function registerMetaAuthHandlers(ipcMain) {
  // ── 0. OAuth genérico — despacha al provider correcto ──────────────────
  ipcMain.handle('oauth-start', async (_event, { platform } = {}) => {
    try {
      const provider = OAUTH_PROVIDERS[platform]
      if (!provider) {
        return { success: false, error: `Plataforma OAuth no soportada: ${platform}` }
      }
      return await provider()
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 0b. Auto-crear empresas desde resultado OAuth ──────────────────────
  ipcMain.handle('oauth-auto-create-accounts', async (_event, { accounts, user_token } = {}) => {
    try {
      const { saveCompanyInternal } = require('./company')
      const { facebookApiRequest } = require('../facebook/api')
      const fs = require('fs')
      const path = require('path')

      if (!Array.isArray(accounts) || accounts.length === 0) {
        return { success: false, error: 'No se recibieron cuentas para crear.' }
      }

      // Auto-detectar ad accounts del usuario (para campañas de ads)
      let userAdAccounts = []
      if (user_token) {
        try {
          const adResult = await facebookApiRequest('GET', 'me/adaccounts', {
            fields: 'id,account_id,name,account_status,currency',
            limit: '25',
          }, user_token)
          userAdAccounts = Array.isArray(adResult?.data) ? adResult.data : []
          console.log(`[OAuth] Ad accounts detectados: ${userAdAccounts.map(a => a.name || a.id).join(', ') || 'ninguno'}`)
        } catch (err) {
          console.log(`[OAuth] No se pudieron obtener ad accounts: ${err.message}`)
        }
      }
      // Primer ad account activo del usuario
      const primaryAdAccount = userAdAccounts.find(a => a.account_status === 1) || userAdAccounts[0] || null

      const created = []
      const errors = []
      const logosDir = path.join(require('../config/project-paths').PROJECT_ROOT, 'assets', 'logos')

      for (const account of accounts) {
        try {
          const details = account.details || {}
          const pageName = details.name || account.name || `Pagina ${account.id}`

          // Descargar logo de la pagina si hay picture_url
          let logoPath = ''
          if (details.picture_url) {
            try {
              if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true })
              const logoFile = `page_${account.id}.png`
              const destPath = path.join(logosDir, logoFile)
              await downloadFile(details.picture_url, destPath)
              logoPath = destPath
            } catch { /* logo download failed, continue without */ }
          }

          // Construir payload compatible con saveCompanyInternal
          const platforms = {
            facebook: { enabled: false, syncToConfig: true, accounts: [] },
            instagram: { enabled: false, syncToConfig: true, accounts: [] },
            tiktok: { enabled: false, syncToConfig: true, accounts: [] },
            linkedin: { enabled: false, syncToConfig: true, accounts: [] },
            googleads: { enabled: false, syncToConfig: true, accounts: [] },
          }

          // Facebook account + ad_account_id del usuario
          if (account.platform === 'facebook') {
            platforms.facebook = {
              enabled: true,
              syncToConfig: true,
              accounts: [{
                account_label: pageName,
                token: account.access_token,
                page_id: account.id,
              }],
            }
          }

          // TikTok account
          if (account.platform === 'tiktok') {
            platforms.tiktok = {
              enabled: true,
              syncToConfig: true,
              accounts: [{
                account_label: pageName,
                token: account.access_token,
              }],
            }
          }

          // Instagram auto-link si la pagina tiene IG business
          if (details.instagram && details.instagram.id) {
            platforms.instagram = {
              enabled: true,
              syncToConfig: true,
              accounts: [{
                account_label: details.instagram.username || details.instagram.name || pageName,
                token: account.access_token,
                account_id: details.instagram.id,
              }],
            }
          }

          const savedCompany = saveCompanyInternal({
            nombre: pageName,
            telefono: details.phone || '',
            correo: details.email || '',
            sitio_web: details.website || '',
            descripcion: details.about || '',
            logo: logoPath,
            activo: true,
            platforms,
          })

          // Guardar datos extra de OAuth (ad_account, user_token) en archivo JSON
          try {
            const metaDir = path.join(require('../config/project-paths').PROJECT_ROOT, 'memory', 'companies')
            if (!fs.existsSync(metaDir)) fs.mkdirSync(metaDir, { recursive: true })
            const metaFile = path.join(metaDir, `${pageName.replace(/[^a-zA-Z0-9áéíóúñ ]/g, '_')}.json`)
            const metaData = {
              page_id: account.id,
              page_name: pageName,
              ad_account_id: primaryAdAccount?.id || '',
              ad_account_name: primaryAdAccount?.name || '',
              user_token: user_token || '',
              updated_at: new Date().toISOString(),
            }
            fs.writeFileSync(metaFile, JSON.stringify(metaData, null, 2))
            console.log(`[OAuth] Datos extra guardados para "${pageName}": ad_account=${primaryAdAccount?.id || 'none'}`)
          } catch { /* non-critical */ }

          created.push(savedCompany)
        } catch (err) {
          errors.push({ account_id: account.id, account_name: account.name, error: err.message })
        }
      }

      return {
        success: true,
        created,
        errors,
        total: accounts.length,
        created_count: created.length,
        error_count: errors.length,
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Backward compat: mantener meta-start-oauth como alias de oauth-start facebook
  ipcMain.handle('meta-start-oauth', async () => {
    try {
      const provider = OAUTH_PROVIDERS.facebook
      return await provider()
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 1. App Access Token ──────────────────────────────────────────────────
  ipcMain.handle('meta-get-app-token', async (_event, payload = {}) => {
    try {
      const result = await getAppAccessToken(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 2. OAuth Flow ────────────────────────────────────────────────────────
  ipcMain.handle('meta-get-oauth-url', async (_event, payload = {}) => {
    try {
      const url = getOAuthLoginUrl(payload)
      return { success: true, url }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-exchange-code', async (_event, payload = {}) => {
    try {
      const result = await exchangeCodeForToken(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-exchange-long-lived', async (_event, payload = {}) => {
    try {
      const result = await exchangeForLongLivedToken(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 3. Page Tokens ───────────────────────────────────────────────────────
  ipcMain.handle('meta-get-page-tokens', async (_event, payload = {}) => {
    try {
      const pages = await getPageAccessTokens(payload)
      return { success: true, pages }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Token Debug ──────────────────────────────────────────────────────────
  ipcMain.handle('meta-debug-token', async (_event, payload = {}) => {
    try {
      const result = await debugToken(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Check token permissions (scopes) for a specific account ────────────
  ipcMain.handle('meta-check-token-permissions', async (_event, { token } = {}) => {
    try {
      if (!token) return { success: false, error: 'Token requerido.' }
      const result = await debugToken({ inputToken: token })
      return { success: true, scopes: result.scopes || [], is_valid: result.is_valid, expires_at: result.expires_at }
    } catch (err) {
      return { success: false, error: err.message, scopes: [] }
    }
  })

  // ── 4. Campaign Pipeline (individual steps) ─────────────────────────────

  ipcMain.handle('meta-upload-ad-image', async (_event, payload = {}) => {
    try {
      const result = await uploadAdImage(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-create-leadgen-form', async (_event, payload = {}) => {
    try {
      const result = await createLeadgenForm(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-create-campaign', async (_event, payload = {}) => {
    try {
      const result = await createCampaign(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-create-adset', async (_event, payload = {}) => {
    try {
      const result = await createAdSet(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-create-ad-creative', async (_event, payload = {}) => {
    try {
      const result = await createAdCreative(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-create-ad', async (_event, payload = {}) => {
    try {
      const result = await createAd(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-activate-campaign', async (_event, payload = {}) => {
    try {
      const result = await activateCampaign(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Pipeline completo (6 pasos en secuencia) ────────────────────────────
  ipcMain.handle('meta-execute-lead-pipeline', async (event, payload = {}) => {
    try {
      const result = await executeLeadCampaignPipeline({
        ...payload,
        onStep: (step, msg) => {
          if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('meta-pipeline-step', { step, message: msg })
          }
        },
      })

      const hasErrors = result.errors.length > 0
      return {
        success: !hasErrors,
        ...result,
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 5. Page Posts ────────────────────────────────────────────────────────
  ipcMain.handle('meta-publish-page-post', async (_event, payload = {}) => {
    try {
      const result = await publishPagePost(payload)
      if (result.post_id) {
        try {
          const { insertPublication } = require('../data/publications')
          insertPublication({
            postId: result.post_id,
            platform: 'facebook',
            pageId: payload.pageId || '',
            pageName: payload.pageName || '',
            companyName: payload.companyName || '',
            contentType: payload.link ? 'link' : 'text',
            message: payload.message || '',
            imageUrl: '',
            status: 'published',
          })
        } catch (err) { console.warn('[Publications] Error recording post:', err.message) }
      }
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-publish-page-photo', async (_event, payload = {}) => {
    try {
      const result = await publishPagePhoto(payload)
      if (result.post_id || result.photo_id) {
        try {
          const { insertPublication } = require('../data/publications')
          insertPublication({
            postId: result.post_id || result.photo_id,
            platform: 'facebook',
            pageId: payload.pageId || '',
            pageName: payload.pageName || '',
            companyName: payload.companyName || '',
            contentType: 'image',
            message: payload.message || '',
            imageUrl: payload.imageUrl || '',
            status: 'published',
          })
        } catch (err) { console.warn('[Publications] Error recording post:', err.message) }
      }
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerMetaAuthHandlers }
