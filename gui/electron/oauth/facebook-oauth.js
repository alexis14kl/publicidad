/**
 * Facebook OAuth Provider
 *
 * Implementa la interfaz genérica de OAuth para Facebook:
 * - startOAuth() → OAuthResult con páginas enriquecidas
 * - Usa oauth-manager.js para el servidor HTTPS local
 * - Llama Graph API para detalles de cada página + IG auto-link
 */

const { startOAuthFlow, buildRedirectUri, DEFAULT_PORT } = require('./oauth-manager')
const {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getPageAccessTokens,
  getAppCredentials,
  fetchPageDetails,
  DEFAULT_SCOPES,
} = require('../facebook/meta-marketing-api')
const { getProjectEnv } = require('../utils/env')

const GRAPH_API_VERSION = 'v25.0'
const CALLBACK_PATH = '/auth/facebook/callback'

/**
 * Ejecuta el flujo OAuth completo de Facebook.
 *
 * @returns {Promise<OAuthResult>}
 */
async function startFacebookOAuth() {
  const creds = getAppCredentials()
  const env = getProjectEnv()
  const configId = String(env.FB_LOGIN_CONFIG_ID || '').trim()

  if (!creds.appId || !creds.appSecret) {
    return {
      success: false,
      platform: 'facebook',
      error: 'FB_APP_ID y FB_APP_SECRET son requeridos en .env para usar OAuth.',
    }
  }

  if (!configId) {
    return {
      success: false,
      platform: 'facebook',
      error: 'FB_LOGIN_CONFIG_ID es requerido en .env.',
    }
  }

  const redirectUri = buildRedirectUri(DEFAULT_PORT, CALLBACK_PATH)

  // Construir URL de OAuth con todos los scopes necesarios
  const url = new URL(`https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`)
  url.searchParams.set('client_id', creds.appId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('config_id', configId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', DEFAULT_SCOPES.join(','))
  const oauthUrl = url.toString()

  console.log('[FacebookOAuth] URL:', oauthUrl)

  try {
    // 1. Abrir browser y capturar code via servidor HTTPS local
    const { code } = await startOAuthFlow({
      oauthUrl,
      callbackPath: CALLBACK_PATH,
    })

    // 2. Intercambiar code por tokens y obtener páginas
    const result = await handleCodeExchange(code, redirectUri)
    return result
  } catch (err) {
    return {
      success: false,
      platform: 'facebook',
      error: err.message || String(err),
    }
  }
}

/**
 * Intercambia el code por tokens, obtiene páginas, y enriquece con detalles.
 */
async function handleCodeExchange(code, redirectUri) {
  const creds = getAppCredentials()

  // 1. Code → short-lived token
  const shortResult = await exchangeCodeForToken({
    code,
    redirectUri,
    appId: creds.appId,
    appSecret: creds.appSecret,
  })
  if (!shortResult.access_token) {
    throw new Error('No se pudo obtener el access token de Facebook.')
  }

  // 2. Short → long-lived token (60 dias)
  let userToken = shortResult.access_token
  let expiresIn = shortResult.expires_in

  try {
    const longResult = await exchangeForLongLivedToken({
      shortLivedToken: shortResult.access_token,
    })
    if (longResult.access_token) {
      userToken = longResult.access_token
      expiresIn = longResult.expires_in
    }
  } catch {
    // Si falla la extension, seguimos con el short-lived
  }

  // 3. Obtener Pages del usuario
  const pages = await getPageAccessTokens({ userToken })

  // 4. Enriquecer cada página con detalles (nombre, website, phone, IG, etc.)
  const accounts = await Promise.all(
    pages.map(async (page) => {
      let details = null
      try {
        details = await fetchPageDetails({
          pageId: page.id,
          pageAccessToken: page.access_token,
        })
      } catch (err) {
        console.warn(`[FacebookOAuth] No se pudieron obtener detalles de pagina ${page.id}:`, err.message)
      }

      return {
        id: page.id,
        name: details?.name || page.name || '',
        access_token: page.access_token,
        platform: 'facebook',
        details,
      }
    })
  )

  return {
    success: true,
    platform: 'facebook',
    user_token: userToken,
    expires_in: expiresIn,
    accounts,
  }
}

module.exports = { startFacebookOAuth }
