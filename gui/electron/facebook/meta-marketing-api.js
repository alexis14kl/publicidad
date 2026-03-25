/**
 * Meta Marketing API — Endpoints para crear campanas de Facebook Ads
 *
 * Flujo completo basado en la documentacion oficial de Meta:
 * 1. App Access Token (server-to-server)
 * 2. User Access Token (OAuth login + exchange)
 * 3. Page Access Token (desde user token)
 * 4. Campaign creation pipeline (6 pasos)
 * 5. Page post publishing
 *
 * API version: v25.0
 * Ref: developers.facebook.com/docs/marketing-api
 */

const { facebookApiRequest } = require('./api')
const { getProjectEnv } = require('../utils/env')
const fs = require('fs')
const path = require('path')

const GRAPH_API_VERSION = 'v25.0'
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`
const OAUTH_BASE_URL = `https://graph.facebook.com/oauth`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAppCredentials() {
  const env = getProjectEnv()
  return {
    appId: String(env.FB_APP_ID || '').trim(),
    appSecret: String(env.FB_APP_SECRET || '').trim(),
    redirectUri: String(env.FB_OAUTH_REDIRECT_URI || 'https://localhost:3000/auth/facebook/callback').trim(),
  }
}

function getConfiguredTokens() {
  const env = getProjectEnv()
  return {
    accessToken: String(env.FB_ACCESS_TOKEN || '').trim(),
    pageAccessToken: String(env.FB_PAGE_ACCESS_TOKEN || '').trim(),
    pageId: String(env.FB_PAGE_ID || '').trim(),
    adAccountId: normalizeAdAccountId(String(env.FB_AD_ACCOUNT_ID || '').trim()),
  }
}

function normalizeAdAccountId(id) {
  const cleaned = String(id || '').trim()
  if (!cleaned) return ''
  return cleaned.startsWith('act_') ? cleaned : `act_${cleaned}`
}

function graphApiRequest(method, endpoint, params = {}, token = '') {
  const cleanEndpoint = endpoint.replace(/^\/+/, '')
  return facebookApiRequest(method, cleanEndpoint, params, token)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. APP ACCESS TOKEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Obtiene un App Access Token (no expira, solo server-side).
 * GET https://graph.facebook.com/oauth/access_token
 *   ?client_id={APP_ID}&client_secret={APP_SECRET}&grant_type=client_credentials
 */
async function getAppAccessToken({ appId, appSecret } = {}) {
  const creds = getAppCredentials()
  const resolvedAppId = appId || creds.appId
  const resolvedSecret = appSecret || creds.appSecret

  if (!resolvedAppId || !resolvedSecret) {
    throw new Error('FB_APP_ID y FB_APP_SECRET son requeridos. Configuralos en .env')
  }

  const result = await graphApiRequest('GET', '../oauth/access_token', {
    client_id: resolvedAppId,
    client_secret: resolvedSecret,
    grant_type: 'client_credentials',
  })

  return {
    access_token: result.access_token,
    token_type: result.token_type || 'bearer',
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. USER ACCESS TOKEN (OAuth Flow)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DEFAULT_SCOPES = [
  'ads_management',
  'ads_read',
  'leads_retrieval',
  'pages_manage_ads',
  'pages_read_engagement',
  'pages_show_list',
]

/**
 * Paso 1: Genera la URL de login para redirigir al usuario.
 */
function getOAuthLoginUrl({ appId, redirectUri, scopes } = {}) {
  const creds = getAppCredentials()
  const resolvedAppId = appId || creds.appId
  const resolvedRedirectUri = redirectUri || creds.redirectUri
  const resolvedScopes = scopes || DEFAULT_SCOPES

  if (!resolvedAppId) {
    throw new Error('FB_APP_ID es requerido para generar la URL de login OAuth.')
  }

  const url = new URL(`https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`)
  url.searchParams.set('client_id', resolvedAppId)
  url.searchParams.set('redirect_uri', resolvedRedirectUri)
  url.searchParams.set('scope', resolvedScopes.join(','))

  return url.toString()
}

/**
 * Paso 2: Intercambia el code por un short-lived user token.
 */
async function exchangeCodeForToken({ code, appId, appSecret, redirectUri } = {}) {
  const creds = getAppCredentials()
  const resolvedAppId = appId || creds.appId
  const resolvedSecret = appSecret || creds.appSecret
  const resolvedRedirectUri = redirectUri || creds.redirectUri

  if (!code) throw new Error('El code de OAuth es requerido.')
  if (!resolvedAppId || !resolvedSecret) {
    throw new Error('FB_APP_ID y FB_APP_SECRET son requeridos.')
  }

  const result = await graphApiRequest('GET', 'oauth/access_token', {
    client_id: resolvedAppId,
    redirect_uri: resolvedRedirectUri,
    client_secret: resolvedSecret,
    code,
  })

  return {
    access_token: result.access_token,
    token_type: result.token_type || 'bearer',
    expires_in: result.expires_in || null,
  }
}

/**
 * Paso 3: Extiende un short-lived token a long-lived (hasta 60 dias).
 */
async function exchangeForLongLivedToken({ shortLivedToken, appId, appSecret } = {}) {
  const creds = getAppCredentials()
  const resolvedAppId = appId || creds.appId
  const resolvedSecret = appSecret || creds.appSecret

  if (!shortLivedToken) throw new Error('Se requiere un short-lived token.')
  if (!resolvedAppId || !resolvedSecret) {
    throw new Error('FB_APP_ID y FB_APP_SECRET son requeridos.')
  }

  const result = await graphApiRequest('GET', 'oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: resolvedAppId,
    client_secret: resolvedSecret,
    fb_exchange_token: shortLivedToken,
  })

  return {
    access_token: result.access_token,
    token_type: result.token_type || 'bearer',
    expires_in: result.expires_in || null,
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. PAGE ACCESS TOKEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Obtiene las paginas donde el usuario es admin + sus Page Tokens.
 * GET /me/accounts?access_token={USER_TOKEN}
 */
async function getPageAccessTokens({ userToken } = {}) {
  const tokens = getConfiguredTokens()
  const resolvedToken = userToken || tokens.accessToken

  if (!resolvedToken) {
    throw new Error('Se requiere un User Access Token para obtener Page Tokens.')
  }

  const result = await graphApiRequest('GET', 'me/accounts', {
    fields: 'id,name,access_token,category,tasks',
  }, resolvedToken)

  const pages = Array.isArray(result?.data) ? result.data : []

  return pages.map((page) => ({
    id: String(page.id || ''),
    name: String(page.name || ''),
    access_token: String(page.access_token || ''),
    category: String(page.category || ''),
    tasks: Array.isArray(page.tasks) ? page.tasks : [],
  }))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. CAMPAIGN CREATION PIPELINE (6 pasos)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * PASO 1: Subir imagen al ad account.
 * POST /act_{AD_ACCOUNT_ID}/adimages
 */
async function uploadAdImage({ adAccountId, imageBase64, imagePath, token } = {}) {
  const tokens = getConfiguredTokens()
  const resolvedToken = token || tokens.accessToken
  const resolvedAccount = normalizeAdAccountId(adAccountId || tokens.adAccountId)

  if (!resolvedToken) throw new Error('Se requiere un Access Token.')
  if (!resolvedAccount) throw new Error('Se requiere un Ad Account ID.')

  let base64Data = imageBase64
  if (!base64Data && imagePath) {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`La imagen no existe: ${imagePath}`)
    }
    base64Data = fs.readFileSync(imagePath).toString('base64')
  }

  if (!base64Data) throw new Error('Se requiere imageBase64 o imagePath.')

  const result = await graphApiRequest('POST', `${resolvedAccount}/adimages`, {
    bytes: base64Data,
  }, resolvedToken)

  const images = result?.images || {}
  const firstKey = Object.keys(images)[0]
  const imageData = images[firstKey] || {}

  return {
    image_hash: imageData.hash || imageData.image_hash || '',
    url: imageData.url || '',
    name: firstKey || '',
  }
}

/**
 * PASO 2: Crear formulario de leads.
 * POST /{PAGE_ID}/leadgen_forms
 * Requiere Page Token.
 */
async function createLeadgenForm({
  pageId,
  token,
  name = 'Formulario Leads',
  questions,
  privacyPolicyUrl = 'https://noyecode.com/privacidad',
  thankYouTitle = 'Gracias!',
  thankYouBody = 'Nos pondremos en contacto contigo pronto.',
  locale = 'es_LA',
} = {}) {
  const tokens = getConfiguredTokens()
  const resolvedToken = token || tokens.pageAccessToken || tokens.accessToken
  const resolvedPageId = pageId || tokens.pageId

  if (!resolvedToken) throw new Error('Se requiere un Page Token para crear formularios de leads.')
  if (!resolvedPageId) throw new Error('Se requiere un Page ID.')

  const defaultQuestions = [
    { type: 'FULL_NAME' },
    { type: 'EMAIL' },
    { type: 'PHONE' },
  ]

  const formPayload = {
    name,
    questions: JSON.stringify(questions || defaultQuestions),
    privacy_policy: JSON.stringify({
      url: privacyPolicyUrl,
      link_text: 'Politica de privacidad',
    }),
    thank_you_page: JSON.stringify({
      title: thankYouTitle,
      body: thankYouBody,
    }),
    locale,
  }

  const result = await graphApiRequest('POST', `${resolvedPageId}/leadgen_forms`, formPayload, resolvedToken)

  return {
    form_id: result.id || '',
  }
}

/**
 * PASO 3: Crear campana.
 * POST /act_{AD_ACCOUNT_ID}/campaigns
 */
async function createCampaign({
  adAccountId,
  token,
  name = 'Campana NoyeCode',
  objective = 'OUTCOME_LEADS',
  status = 'PAUSED',
  specialAdCategories = [],
  bidStrategy = 'LOWEST_COST_WITHOUT_CAP',
} = {}) {
  const tokens = getConfiguredTokens()
  const resolvedToken = token || tokens.accessToken
  const resolvedAccount = normalizeAdAccountId(adAccountId || tokens.adAccountId)

  if (!resolvedToken) throw new Error('Se requiere un Access Token.')
  if (!resolvedAccount) throw new Error('Se requiere un Ad Account ID.')

  const result = await graphApiRequest('POST', `${resolvedAccount}/campaigns`, {
    name,
    objective,
    status,
    special_ad_categories: JSON.stringify(specialAdCategories),
    bid_strategy: bidStrategy,
  }, resolvedToken)

  return {
    campaign_id: result.id || '',
  }
}

/**
 * PASO 4: Crear Ad Set.
 * POST /act_{AD_ACCOUNT_ID}/adsets
 */
async function createAdSet({
  adAccountId,
  token,
  name = 'Conjunto NoyeCode',
  campaignId,
  optimizationGoal = 'LEAD_GENERATION',
  billingEvent = 'IMPRESSIONS',
  dailyBudget = 50000,
  bidAmount,
  status = 'PAUSED',
  pageId,
  targeting,
} = {}) {
  const tokens = getConfiguredTokens()
  const resolvedToken = token || tokens.accessToken
  const resolvedAccount = normalizeAdAccountId(adAccountId || tokens.adAccountId)
  const resolvedPageId = pageId || tokens.pageId

  if (!resolvedToken) throw new Error('Se requiere un Access Token.')
  if (!resolvedAccount) throw new Error('Se requiere un Ad Account ID.')
  if (!campaignId) throw new Error('Se requiere un campaign_id.')
  if (!resolvedPageId) throw new Error('Se requiere un page_id para Lead Generation.')

  const defaultTargeting = {
    geo_locations: { countries: ['CO'] },
    age_min: 25,
    age_max: 55,
    genders: [0],
  }

  const payload = {
    name,
    campaign_id: campaignId,
    optimization_goal: optimizationGoal,
    billing_event: billingEvent,
    daily_budget: String(dailyBudget),
    status,
    promoted_object: JSON.stringify({ page_id: resolvedPageId }),
    targeting: JSON.stringify(targeting || defaultTargeting),
  }

  if (bidAmount) {
    payload.bid_amount = String(bidAmount)
  }

  const result = await graphApiRequest('POST', `${resolvedAccount}/adsets`, payload, resolvedToken)

  return {
    adset_id: result.id || '',
  }
}

/**
 * PASO 5: Crear Ad Creative.
 * POST /act_{AD_ACCOUNT_ID}/adcreatives
 */
async function createAdCreative({
  adAccountId,
  token,
  name = 'Creative NoyeCode',
  pageId,
  imageHash,
  message = '',
  caption = '',
  callToActionType = 'SIGN_UP',
  leadgenFormId,
} = {}) {
  const tokens = getConfiguredTokens()
  const resolvedToken = token || tokens.accessToken
  const resolvedAccount = normalizeAdAccountId(adAccountId || tokens.adAccountId)
  const resolvedPageId = pageId || tokens.pageId

  if (!resolvedToken) throw new Error('Se requiere un Access Token.')
  if (!resolvedAccount) throw new Error('Se requiere un Ad Account ID.')
  if (!resolvedPageId) throw new Error('Se requiere un page_id.')
  if (!imageHash) throw new Error('Se requiere un image_hash (sube la imagen con uploadAdImage primero).')

  const objectStorySpec = {
    page_id: resolvedPageId,
    link_data: {
      image_hash: imageHash,
      message: message,
      caption: caption,
      call_to_action: {
        type: callToActionType,
      },
    },
  }

  if (leadgenFormId) {
    objectStorySpec.link_data.call_to_action.value = {
      lead_gen_form_id: leadgenFormId,
    }
  }

  const result = await graphApiRequest('POST', `${resolvedAccount}/adcreatives`, {
    name,
    object_story_spec: JSON.stringify(objectStorySpec),
  }, resolvedToken)

  return {
    creative_id: result.id || '',
  }
}

/**
 * PASO 6: Crear Ad (paso final).
 * POST /act_{AD_ACCOUNT_ID}/ads
 */
async function createAd({
  adAccountId,
  token,
  name = 'Anuncio NoyeCode',
  adsetId,
  creativeId,
  status = 'PAUSED',
} = {}) {
  const tokens = getConfiguredTokens()
  const resolvedToken = token || tokens.accessToken
  const resolvedAccount = normalizeAdAccountId(adAccountId || tokens.adAccountId)

  if (!resolvedToken) throw new Error('Se requiere un Access Token.')
  if (!resolvedAccount) throw new Error('Se requiere un Ad Account ID.')
  if (!adsetId) throw new Error('Se requiere un adset_id.')
  if (!creativeId) throw new Error('Se requiere un creative_id.')

  const result = await graphApiRequest('POST', `${resolvedAccount}/ads`, {
    name,
    adset_id: adsetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status,
  }, resolvedToken)

  return {
    ad_id: result.id || '',
  }
}

/**
 * Activar una campana (cambiar status a ACTIVE).
 * POST /{CAMPAIGN_ID}
 */
async function activateCampaign({ campaignId, token } = {}) {
  const tokens = getConfiguredTokens()
  const resolvedToken = token || tokens.accessToken

  if (!resolvedToken) throw new Error('Se requiere un Access Token.')
  if (!campaignId) throw new Error('Se requiere un campaign_id.')

  const result = await graphApiRequest('POST', campaignId, {
    status: 'ACTIVE',
  }, resolvedToken)

  return {
    success: result.success !== false,
    campaign_id: campaignId,
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PIPELINE COMPLETO: ejecuta los 6 pasos en secuencia
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Ejecuta el pipeline completo de creacion de campana de leads.
 * Retorna un objeto con todos los IDs creados en cada paso.
 */
async function executeLeadCampaignPipeline({
  token,
  pageToken,
  adAccountId,
  pageId,
  // Imagen
  imageBase64,
  imagePath,
  // Formulario
  formName,
  formQuestions,
  privacyPolicyUrl,
  // Campana
  campaignName,
  campaignObjective,
  bidStrategy,
  // Ad Set
  adsetName,
  dailyBudget,
  bidAmount,
  targeting,
  // Creative
  creativeName,
  message,
  caption,
  callToActionType,
  // Ad
  adName,
  // Callbacks
  onStep,
} = {}) {
  const log = (step, msg) => {
    if (typeof onStep === 'function') onStep(step, msg)
  }

  const result = {
    image_hash: null,
    form_id: null,
    campaign_id: null,
    adset_id: null,
    creative_id: null,
    ad_id: null,
    errors: [],
  }

  try {
    // PASO 1: Subir imagen
    log(1, 'Subiendo imagen al ad account...')
    const imageResult = await uploadAdImage({ adAccountId, imageBase64, imagePath, token })
    result.image_hash = imageResult.image_hash
    log(1, `Imagen subida: hash=${imageResult.image_hash}`)

    // PASO 2: Crear formulario de leads
    log(2, 'Creando formulario de leads...')
    const formResult = await createLeadgenForm({
      pageId,
      token: pageToken || token,
      name: formName,
      questions: formQuestions,
      privacyPolicyUrl,
    })
    result.form_id = formResult.form_id
    log(2, `Formulario creado: id=${formResult.form_id}`)

    // PASO 3: Crear campana
    log(3, 'Creando campana...')
    const campaignResult = await createCampaign({
      adAccountId,
      token,
      name: campaignName,
      objective: campaignObjective,
      bidStrategy,
    })
    result.campaign_id = campaignResult.campaign_id
    log(3, `Campana creada: id=${campaignResult.campaign_id}`)

    // PASO 4: Crear Ad Set
    log(4, 'Creando conjunto de anuncios...')
    const adsetResult = await createAdSet({
      adAccountId,
      token,
      name: adsetName,
      campaignId: result.campaign_id,
      dailyBudget,
      bidAmount,
      pageId,
      targeting,
    })
    result.adset_id = adsetResult.adset_id
    log(4, `Ad Set creado: id=${adsetResult.adset_id}`)

    // PASO 5: Crear Ad Creative
    log(5, 'Creando contenido del anuncio...')
    const creativeResult = await createAdCreative({
      adAccountId,
      token,
      name: creativeName,
      pageId,
      imageHash: result.image_hash,
      message,
      caption,
      callToActionType,
      leadgenFormId: result.form_id,
    })
    result.creative_id = creativeResult.creative_id
    log(5, `Creative creado: id=${creativeResult.creative_id}`)

    // PASO 6: Crear Ad
    log(6, 'Creando anuncio final...')
    const adResult = await createAd({
      adAccountId,
      token,
      name: adName,
      adsetId: result.adset_id,
      creativeId: result.creative_id,
    })
    result.ad_id = adResult.ad_id
    log(6, `Anuncio creado: id=${adResult.ad_id} (PAUSED)`)
  } catch (err) {
    result.errors.push(err.message || String(err))
  }

  return result
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. PUBLICIDAD EN PAGINA (Page Posts)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Publicar un post de texto/link en la pagina.
 * POST /{PAGE_ID}/feed
 */
async function publishPagePost({ pageId, token, message, link, published = true } = {}) {
  const tokens = getConfiguredTokens()
  const resolvedToken = token || tokens.pageAccessToken || tokens.accessToken
  const resolvedPageId = pageId || tokens.pageId

  if (!resolvedToken) throw new Error('Se requiere un Page Token.')
  if (!resolvedPageId) throw new Error('Se requiere un Page ID.')

  const payload = { published: String(published) }
  if (message) payload.message = message
  if (link) payload.link = link

  const result = await graphApiRequest('POST', `${resolvedPageId}/feed`, payload, resolvedToken)

  return {
    post_id: result.id || '',
  }
}

/**
 * Publicar una foto en la pagina.
 * POST /{PAGE_ID}/photos
 */
async function publishPagePhoto({ pageId, token, imageUrl, message, published = true } = {}) {
  const tokens = getConfiguredTokens()
  const resolvedToken = token || tokens.pageAccessToken || tokens.accessToken
  const resolvedPageId = pageId || tokens.pageId

  if (!resolvedToken) throw new Error('Se requiere un Page Token.')
  if (!resolvedPageId) throw new Error('Se requiere un Page ID.')
  if (!imageUrl) throw new Error('Se requiere una URL de imagen.')

  const result = await graphApiRequest('POST', `${resolvedPageId}/photos`, {
    url: imageUrl,
    message: message || '',
    published: String(published),
  }, resolvedToken)

  return {
    post_id: result.id || result.post_id || '',
    photo_id: result.id || '',
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOKEN DEBUGGING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Inspecciona un token para ver permisos, expiracion, etc.
 */
async function debugToken({ inputToken, appToken, appId, appSecret } = {}) {
  let resolvedAppToken = appToken
  if (!resolvedAppToken) {
    const app = await getAppAccessToken({ appId, appSecret })
    resolvedAppToken = app.access_token
  }

  const result = await graphApiRequest('GET', 'debug_token', {
    input_token: inputToken,
  }, resolvedAppToken)

  const data = result?.data || {}
  return {
    app_id: data.app_id || '',
    type: data.type || '',
    is_valid: Boolean(data.is_valid),
    expires_at: data.expires_at || 0,
    scopes: Array.isArray(data.scopes) ? data.scopes : [],
    user_id: data.user_id || '',
    error: data.error || null,
  }
}

module.exports = {
  // Config helpers
  getAppCredentials,
  getConfiguredTokens,
  normalizeAdAccountId,
  // 1. App Token
  getAppAccessToken,
  // 2. User Token (OAuth)
  getOAuthLoginUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  DEFAULT_SCOPES,
  // 3. Page Token
  getPageAccessTokens,
  // 4. Campaign Pipeline
  uploadAdImage,
  createLeadgenForm,
  createCampaign,
  createAdSet,
  createAdCreative,
  createAd,
  activateCampaign,
  executeLeadCampaignPipeline,
  // 5. Page Posts
  publishPagePost,
  publishPagePhoto,
  // Debug
  debugToken,
}
