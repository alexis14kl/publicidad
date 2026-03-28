/**
 * TikTok OAuth Provider
 *
 * Implementa la interfaz generica de OAuth para TikTok:
 * - startTikTokOAuth() → OAuthResult con cuenta del creator
 * - Usa oauth-manager.js para el servidor HTTPS local
 * - Exchange code → access_token + refresh_token
 * - Fetch user info (username, display_name, avatar)
 *
 * Tokens: access_token expira en 24h, refresh_token en 365 dias.
 * El refresh_token se guarda en la DB para renovacion automatica.
 */

const { startOAuthFlow, buildRedirectUri, DEFAULT_PORT } = require('./oauth-manager')
const { tiktokFormRequest } = require('../tiktok/api')
const { getUserInfo } = require('../tiktok/tiktok-content-api')
const { getProjectEnv } = require('../utils/env')

const CALLBACK_PATH = '/auth/tiktok/callback'

const TIKTOK_SCOPES = [
  'user.info.basic',
  'user.info.profile',
  'video.publish',
  'video.upload',
  'video.list',
]

/**
 * Ejecuta el flujo OAuth completo de TikTok.
 *
 * @returns {Promise<OAuthResult>}
 */
async function startTikTokOAuth() {
  const env = getProjectEnv()
  const clientKey = String(env.TIKTOK_CLIENT_KEY || '').trim()
  const clientSecret = String(env.TIKTOK_CLIENT_SECRET || '').trim()

  if (!clientKey || !clientSecret) {
    return {
      success: false,
      platform: 'tiktok',
      error: 'TIKTOK_CLIENT_KEY y TIKTOK_CLIENT_SECRET son requeridos en .env.',
    }
  }

  const redirectUri = buildRedirectUri(DEFAULT_PORT, CALLBACK_PATH)
  const state = generateState()
  const { codeVerifier, codeChallenge } = generatePKCE()

  // Construir URL de OAuth de TikTok (PKCE obligatorio para desktop apps)
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/')
  url.searchParams.set('client_key', clientKey)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', TIKTOK_SCOPES.join(','))
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  const oauthUrl = url.toString()

  console.log('[TikTokOAuth] URL:', oauthUrl)

  try {
    const { code } = await startOAuthFlow({
      oauthUrl,
      callbackPath: CALLBACK_PATH,
    })

    const result = await handleCodeExchange(code, redirectUri, clientKey, clientSecret, codeVerifier)
    return result
  } catch (err) {
    return {
      success: false,
      platform: 'tiktok',
      error: err.message || String(err),
    }
  }
}

/**
 * Intercambia el code por tokens y obtiene info del usuario.
 */
async function handleCodeExchange(code, redirectUri, clientKey, clientSecret, codeVerifier) {
  // 1. Code → access_token + refresh_token (con PKCE code_verifier)
  const tokenResult = await tiktokFormRequest('/v2/oauth/token/', {
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })

  const accessToken = tokenResult.access_token
  const refreshToken = tokenResult.refresh_token
  const openId = tokenResult.open_id || ''
  const expiresIn = tokenResult.expires_in || 86400

  if (!accessToken) {
    throw new Error('TikTok no retorno un access token.')
  }

  // 2. Obtener info del usuario
  let userInfo = { open_id: openId, username: '', display_name: '', avatar_url: '' }
  try {
    userInfo = await getUserInfo(accessToken)
  } catch (err) {
    console.warn('[TikTokOAuth] No se pudo obtener info del usuario:', err.message)
  }

  const accountName = userInfo.display_name || userInfo.username || `TikTok ${openId}`

  return {
    success: true,
    platform: 'tiktok',
    user_token: accessToken,
    expires_in: expiresIn,
    accounts: [{
      id: userInfo.open_id || openId,
      name: accountName,
      access_token: accessToken,
      platform: 'tiktok',
      details: {
        picture_url: userInfo.avatar_url || null,
        website: null,
        phone: null,
        email: null,
        about: null,
        category: null,
        instagram: null,
        // TikTok-specific: guardar refresh_token y username
        refresh_token: refreshToken,
        username: userInfo.username || '',
      },
    }],
  }
}

/**
 * Genera un state aleatorio para CSRF protection.
 */
function generateState() {
  const crypto = require('crypto')
  return crypto.randomBytes(16).toString('hex')
}

/**
 * Genera PKCE code_verifier y code_challenge (S256).
 * Requerido por TikTok para apps de escritorio/mobile.
 */
function generatePKCE() {
  const crypto = require('crypto')
  // code_verifier: 43-128 chars, URL-safe
  const codeVerifier = crypto.randomBytes(32)
    .toString('base64url')
    .slice(0, 64)
  // code_challenge: SHA256 hash del verifier, base64url encoded
  const codeChallenge = crypto.createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  return { codeVerifier, codeChallenge }
}

module.exports = { startTikTokOAuth }
