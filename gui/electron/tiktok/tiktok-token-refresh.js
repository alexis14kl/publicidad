/**
 * TikTok Token Refresh
 *
 * TikTok access tokens expiran en 24 horas.
 * Refresh tokens duran 365 dias.
 * Este modulo maneja la renovacion automatica.
 */

const { tiktokFormRequest } = require('./api')
const { getProjectEnv } = require('../utils/env')

/**
 * Renueva un access token de TikTok usando el refresh token.
 *
 * POST https://open.tiktokapis.com/v2/oauth/token/
 * Body: client_key, client_secret, grant_type=refresh_token, refresh_token
 *
 * @param {string} refreshToken
 * @returns {Promise<{ access_token, refresh_token, open_id, scope, expires_in, refresh_expires_in }>}
 */
async function refreshTikTokToken(refreshToken) {
  const env = getProjectEnv()
  const clientKey = String(env.TIKTOK_CLIENT_KEY || '').trim()
  const clientSecret = String(env.TIKTOK_CLIENT_SECRET || '').trim()

  if (!clientKey || !clientSecret) {
    throw new Error('TIKTOK_CLIENT_KEY y TIKTOK_CLIENT_SECRET son requeridos en .env.')
  }
  if (!refreshToken) {
    throw new Error('Se requiere un refresh_token para renovar el access token de TikTok.')
  }

  const result = await tiktokFormRequest('/v2/oauth/token/', {
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  if (!result.access_token) {
    throw new Error('TikTok no retorno un access token al renovar.')
  }

  return {
    access_token: result.access_token,
    refresh_token: result.refresh_token || refreshToken,
    open_id: result.open_id || '',
    scope: result.scope || '',
    expires_in: result.expires_in || 86400,
    refresh_expires_in: result.refresh_expires_in || 31536000,
  }
}

/**
 * Revoca un access token de TikTok.
 *
 * POST https://open.tiktokapis.com/v2/oauth/revoke/
 */
async function revokeTikTokToken(accessToken) {
  const env = getProjectEnv()
  const clientKey = String(env.TIKTOK_CLIENT_KEY || '').trim()
  const clientSecret = String(env.TIKTOK_CLIENT_SECRET || '').trim()

  if (!clientKey || !clientSecret) {
    throw new Error('TIKTOK_CLIENT_KEY y TIKTOK_CLIENT_SECRET son requeridos.')
  }

  await tiktokFormRequest('/v2/oauth/revoke/', {
    client_key: clientKey,
    client_secret: clientSecret,
    token: accessToken,
  })
}

module.exports = { refreshTikTokToken, revokeTikTokToken }
