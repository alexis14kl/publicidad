/**
 * TikTok Business API (Marketing API)
 *
 * API separada de la Content Posting API. Usa credenciales y auth diferentes.
 * Base URL: https://business-api.tiktok.com
 * Auth header: Access-Token (no Bearer)
 *
 * Ref: https://business-api.tiktok.com/portal/docs
 * Ref: guia-tiktok-developer-business.html
 */

const https = require('https')

const BUSINESS_API_BASE = 'https://business-api.tiktok.com'
const SANDBOX_API_BASE = 'https://sandbox-ads.tiktok.com'
const REQUEST_TIMEOUT_MS = 30000

// ─── HTTP Request ─────────────────────────────────────────────────────────────

/**
 * Ejecuta una peticion a la TikTok Business API.
 *
 * Diferencias con la Content API:
 * - Header: Access-Token (no Authorization: Bearer)
 * - Base URL: business-api.tiktok.com
 * - Responses: { code: 0, message: 'OK', data: {...} }
 */
function businessApiRequest(method, path, body = {}, accessToken = '', options = {}) {
  const baseUrl = options.sandbox ? SANDBOX_API_BASE : BUSINESS_API_BASE
  const timeout = options.timeout || REQUEST_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`)
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'noyecode-bot/1.0',
    }

    if (accessToken) {
      headers['Access-Token'] = accessToken
    }

    let requestBody = null

    if (method === 'GET') {
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value))
        }
      }
    } else {
      requestBody = JSON.stringify(body)
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(requestBody)
    }

    const request = https.request(url, { method, timeout, headers }, (response) => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { raw += chunk })
      response.on('end', () => {
        try {
          const data = raw ? JSON.parse(raw) : {}
          // Business API success: code === 0
          if (data.code === 0) {
            resolve(data.data || data)
            return
          }
          const errorMessage = [
            data.message || `HTTP ${response.statusCode}`,
            data.code ? `code=${data.code}` : '',
            data.request_id ? `request_id=${data.request_id}` : '',
            `path=${path}`,
          ].filter(Boolean).join(' | ')
          reject(new Error(errorMessage))
        } catch (parseError) {
          reject(new Error(`Respuesta invalida de TikTok Business API: ${parseError.message}`))
        }
      })
    })

    request.on('timeout', () => { request.destroy(new Error('TikTok Business API timeout')) })
    request.on('error', reject)
    if (requestBody) request.write(requestBody)
    request.end()
  })
}

// ─── OAuth (Business) ─────────────────────────────────────────────────────────

/**
 * Intercambia auth_code por access_token de Business.
 * El token de Business NO expira (se revoca manualmente).
 *
 * POST /open_api/v1.3/oauth2/access_token/
 */
async function exchangeBusinessToken({ appId, appSecret, authCode }) {
  if (!appId || !appSecret) throw new Error('TIKTOK_BUSINESS_APP_ID y TIKTOK_BUSINESS_SECRET son requeridos.')
  if (!authCode) throw new Error('Se requiere un auth_code de TikTok Business.')

  const result = await businessApiRequest('POST', '/open_api/v1.3/oauth2/access_token/', {
    app_id: appId,
    secret: appSecret,
    auth_code: authCode,
  })

  return {
    access_token: result.access_token || '',
    advertiser_ids: Array.isArray(result.advertiser_ids) ? result.advertiser_ids : [],
    scope: Array.isArray(result.scope) ? result.scope : [],
  }
}

/**
 * Lista las advertiser accounts autorizadas.
 *
 * GET /open_api/v1.3/oauth2/advertiser/get/
 */
async function getAuthorizedAdvertisers({ appId, appSecret, accessToken }) {
  if (!accessToken) throw new Error('Se requiere un access_token de Business.')

  const result = await businessApiRequest('GET', '/open_api/v1.3/oauth2/advertiser/get/', {
    app_id: appId,
    secret: appSecret,
  }, accessToken)

  const list = Array.isArray(result?.list) ? result.list : []
  return list.map((adv) => ({
    advertiser_id: String(adv.advertiser_id || ''),
    advertiser_name: String(adv.advertiser_name || ''),
  }))
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

/**
 * Crea una campana publicitaria.
 *
 * POST /open_api/v1.3/campaign/create/
 */
async function createCampaign({
  accessToken,
  advertiserId,
  campaignName,
  objectiveType = 'TRAFFIC',
  budgetMode = 'BUDGET_MODE_DAY',
  budget,
  operationStatus = 'DISABLE',
} = {}) {
  if (!accessToken) throw new Error('Se requiere un access_token.')
  if (!advertiserId) throw new Error('Se requiere un advertiser_id.')
  if (!campaignName) throw new Error('Se requiere un campaign_name.')

  const payload = {
    advertiser_id: advertiserId,
    campaign_name: campaignName,
    objective_type: objectiveType,
    budget_mode: budgetMode,
    operation_status: operationStatus,
  }
  if (budget !== undefined) payload.budget = budget

  const result = await businessApiRequest('POST', '/open_api/v1.3/campaign/create/', payload, accessToken)
  return { campaign_id: String(result.campaign_id || '') }
}

/**
 * Obtiene campanas de una advertiser account.
 *
 * GET /open_api/v1.3/campaign/get/
 */
async function getCampaigns({ accessToken, advertiserId, page = 1, pageSize = 20 } = {}) {
  if (!accessToken) throw new Error('Se requiere un access_token.')
  if (!advertiserId) throw new Error('Se requiere un advertiser_id.')

  const result = await businessApiRequest('GET', '/open_api/v1.3/campaign/get/', {
    advertiser_id: advertiserId,
    page,
    page_size: pageSize,
  }, accessToken)

  return {
    campaigns: Array.isArray(result?.list) ? result.list : [],
    total: result?.page_info?.total_number || 0,
  }
}

// ─── Ad Groups ────────────────────────────────────────────────────────────────

/**
 * Crea un ad group (conjunto de anuncios).
 *
 * POST /open_api/v1.3/adgroup/create/
 */
async function createAdGroup({
  accessToken,
  advertiserId,
  campaignId,
  adgroupName,
  placement = ['PLACEMENT_TIKTOK'],
  placementType = 'PLACEMENT_TYPE_NORMAL',
  locationIds = [],
  ageGroups,
  gender = 'GENDER_UNLIMITED',
  budgetMode = 'BUDGET_MODE_DAY',
  budget,
  scheduleStartTime,
  scheduleEndTime,
  optimizeGoal = 'CLICK',
  pacing = 'PACING_MODE_SMOOTH',
  billingEvent = 'CPC',
  bidType = 'BID_TYPE_NO_BID',
  bidPrice,
  operationStatus = 'DISABLE',
} = {}) {
  if (!accessToken) throw new Error('Se requiere un access_token.')
  if (!advertiserId) throw new Error('Se requiere un advertiser_id.')
  if (!campaignId) throw new Error('Se requiere un campaign_id.')
  if (!adgroupName) throw new Error('Se requiere un adgroup_name.')

  const payload = {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    adgroup_name: adgroupName,
    placement_type: placementType,
    placement,
    location_ids: locationIds,
    gender,
    budget_mode: budgetMode,
    optimize_goal: optimizeGoal,
    pacing,
    billing_event: billingEvent,
    bid_type: bidType,
    operation_status: operationStatus,
  }

  if (budget !== undefined) payload.budget = budget
  if (ageGroups) payload.age_groups = ageGroups
  if (scheduleStartTime) payload.schedule_start_time = scheduleStartTime
  if (scheduleEndTime) payload.schedule_end_time = scheduleEndTime
  if (bidPrice !== undefined) payload.bid_price = bidPrice

  const result = await businessApiRequest('POST', '/open_api/v1.3/adgroup/create/', payload, accessToken)
  return { adgroup_id: String(result.adgroup_id || '') }
}

// ─── Ads ──────────────────────────────────────────────────────────────────────

/**
 * Crea un anuncio.
 *
 * POST /open_api/v1.3/ad/create/
 */
async function createAd({
  accessToken,
  advertiserId,
  adgroupId,
  adName,
  adText,
  adFormat = 'SINGLE_VIDEO',
  videoId,
  imageIds,
  displayName,
  identityId,
  identityType,
  landingPageUrl,
  callToAction,
  operationStatus = 'DISABLE',
} = {}) {
  if (!accessToken) throw new Error('Se requiere un access_token.')
  if (!advertiserId) throw new Error('Se requiere un advertiser_id.')
  if (!adgroupId) throw new Error('Se requiere un adgroup_id.')

  const creative = {
    ad_name: adName || 'Anuncio NoyeCode',
    ad_text: adText || '',
    ad_format: adFormat,
  }

  if (videoId) creative.video_id = videoId
  if (imageIds) creative.image_ids = imageIds
  if (displayName) creative.display_name = displayName
  if (identityId) creative.identity_id = identityId
  if (identityType) creative.identity_type = identityType
  if (landingPageUrl) creative.landing_page_url = landingPageUrl
  if (callToAction) creative.call_to_action = callToAction

  const payload = {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    creatives: [creative],
    operation_status: operationStatus,
  }

  const result = await businessApiRequest('POST', '/open_api/v1.3/ad/create/', payload, accessToken)
  const adIds = Array.isArray(result?.ad_ids) ? result.ad_ids : []
  return { ad_id: adIds[0] || '' }
}

// ─── Creative Upload ──────────────────────────────────────────────────────────

/**
 * Sube una imagen creativa para ads.
 *
 * POST /open_api/v1.3/file/image/ad/upload/
 */
async function uploadAdImage({ accessToken, advertiserId, imageUrl, imagePath, fileName } = {}) {
  if (!accessToken) throw new Error('Se requiere un access_token.')
  if (!advertiserId) throw new Error('Se requiere un advertiser_id.')

  const payload = { advertiser_id: advertiserId }

  if (imageUrl) {
    payload.upload_type = 'UPLOAD_BY_URL'
    payload.image_url = imageUrl
  } else if (imagePath) {
    const fs = require('fs')
    if (!fs.existsSync(imagePath)) throw new Error(`Imagen no encontrada: ${imagePath}`)
    payload.upload_type = 'UPLOAD_BY_FILE'
    payload.image_file = fs.readFileSync(imagePath).toString('base64')
    payload.file_name = fileName || require('path').basename(imagePath)
  } else {
    throw new Error('Se requiere imageUrl o imagePath.')
  }

  const result = await businessApiRequest('POST', '/open_api/v1.3/file/image/ad/upload/', payload, accessToken)
  return { image_id: result.image_id || '', image_url: result.image_url || '' }
}

/**
 * Sube un video creativo para ads.
 *
 * POST /open_api/v1.3/file/video/ad/upload/
 */
async function uploadAdVideo({ accessToken, advertiserId, videoUrl, videoPath, fileName } = {}) {
  if (!accessToken) throw new Error('Se requiere un access_token.')
  if (!advertiserId) throw new Error('Se requiere un advertiser_id.')

  const payload = { advertiser_id: advertiserId }

  if (videoUrl) {
    payload.upload_type = 'UPLOAD_BY_URL'
    payload.video_url = videoUrl
  } else if (videoPath) {
    const fs = require('fs')
    if (!fs.existsSync(videoPath)) throw new Error(`Video no encontrado: ${videoPath}`)
    payload.upload_type = 'UPLOAD_BY_FILE'
    payload.video_file = fs.readFileSync(videoPath).toString('base64')
    payload.file_name = fileName || require('path').basename(videoPath)
  } else {
    throw new Error('Se requiere videoUrl o videoPath.')
  }

  const result = await businessApiRequest('POST', '/open_api/v1.3/file/video/ad/upload/', payload, accessToken)
  return { video_id: result.video_id || '' }
}

// ─── Identity ─────────────────────────────────────────────────────────────────

/**
 * Crea una identidad personalizada para anuncios.
 *
 * POST /open_api/v1.3/identity/create/
 */
async function createIdentity({ accessToken, advertiserId, displayName, imageUri } = {}) {
  if (!accessToken) throw new Error('Se requiere un access_token.')
  if (!advertiserId) throw new Error('Se requiere un advertiser_id.')

  const payload = {
    advertiser_id: advertiserId,
    display_name: displayName || 'NoyeCode',
  }
  if (imageUri) payload.image_uri = imageUri

  const result = await businessApiRequest('POST', '/open_api/v1.3/identity/create/', payload, accessToken)
  return { identity_id: result.identity_id || '' }
}

/**
 * Lista identidades disponibles del ad account.
 *
 * GET /open_api/v1.3/identity/get/
 */
async function getIdentities({ accessToken, advertiserId } = {}) {
  if (!accessToken) throw new Error('Se requiere un access_token.')
  if (!advertiserId) throw new Error('Se requiere un advertiser_id.')

  const result = await businessApiRequest('GET', '/open_api/v1.3/identity/get/', {
    advertiser_id: advertiserId,
  }, accessToken)

  return Array.isArray(result?.list) ? result.list : []
}

// ─── Status Updates ───────────────────────────────────────────────────────────

/**
 * Actualiza el estado de una campana, ad group o ad.
 */
async function updateStatus({ accessToken, advertiserId, entity, entityIds, status } = {}) {
  if (!accessToken) throw new Error('Se requiere un access_token.')
  if (!advertiserId) throw new Error('Se requiere un advertiser_id.')

  const entityMap = {
    campaign: '/open_api/v1.3/campaign/status/update/',
    adgroup: '/open_api/v1.3/adgroup/status/update/',
    ad: '/open_api/v1.3/ad/status/update/',
  }

  const path = entityMap[entity]
  if (!path) throw new Error(`Entidad no valida: ${entity}. Usar campaign, adgroup o ad.`)

  const idKey = entity === 'campaign' ? 'campaign_ids'
    : entity === 'adgroup' ? 'adgroup_ids'
    : 'ad_ids'

  await businessApiRequest('POST', path, {
    advertiser_id: advertiserId,
    [idKey]: Array.isArray(entityIds) ? entityIds : [entityIds],
    opt_status: status,
  }, accessToken)
}

module.exports = {
  businessApiRequest,
  // OAuth
  exchangeBusinessToken,
  getAuthorizedAdvertisers,
  // Campaigns
  createCampaign,
  getCampaigns,
  // Ad Groups
  createAdGroup,
  // Ads
  createAd,
  // Creative Upload
  uploadAdImage,
  uploadAdVideo,
  // Identity
  createIdentity,
  getIdentities,
  // Status
  updateStatus,
}
