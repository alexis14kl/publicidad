const https = require('https')
const fs = require('fs')
const path = require('path')
const { PROJECT_ROOT } = require('../config/project-paths')
const { getProjectEnv } = require('../utils/env')
const { findPython } = require('../utils/process')

function getFacebookAdsCdpInfo() {
  const env = getProjectEnv()
  const serverPath = path.join(PROJECT_ROOT, 'core', 'utils', 'AgenteMarketing', 'CDP', 'fb_ads_cdp_server.py')
  const helperPath = path.join(__dirname, 'fb_ads_cdp_run.py')
  const token =
    env.FB_ACCESS_TOKEN ||
    env.FACEBOOK_ACCESS_TOKEN ||
    env.META_ACCESS_TOKEN ||
    ''

  return {
    serverPath,
    helperPath,
    serverExists: fs.existsSync(serverPath),
    helperExists: fs.existsSync(helperPath),
    pythonBin: findPython(),
    token,
    cdpPort: parseInt(env.CDP_PORT || '9225', 10),
  }
}

function getMetaPageId() {
  const env = getProjectEnv()
  const configuredPageId = (
    env.FB_PAGE_ID ||
    env.FACEBOOK_PAGE_ID ||
    env.META_PAGE_ID ||
    '1675432206759799'
  )
  const targetAdAccountId = (
    env.FB_AD_ACCOUNT_ID ||
    env.FACEBOOK_AD_ACCOUNT_ID ||
    env.META_AD_ACCOUNT_ID ||
    '438871067037500'
  )

  const normalizedPageId = String(configuredPageId || '').replace(/^act_/, '').trim()
  const normalizedAdAccountId = String(targetAdAccountId || '').replace(/^act_/, '').trim()

  if (!normalizedPageId || normalizedPageId === normalizedAdAccountId) {
    return '1675432206759799'
  }

  return normalizedPageId
}

function getTargetAdAccountId() {
  const env = getProjectEnv()
  return (
    env.FB_AD_ACCOUNT_ID ||
    env.FACEBOOK_AD_ACCOUNT_ID ||
    env.META_AD_ACCOUNT_ID ||
    '438871067037500'
  )
}

function getFacebookPagePhotosUrl() {
  const env = getProjectEnv()
  return String(env.FB_PAGE_PHOTOS_URL || 'https://www.facebook.com/Noyecode12/photos').trim()
}

async function resolveFacebookPageIdentity({ pageId = '', accessToken = '', pageAccessToken = '' } = {}) {
  const normalizedPageId = String(pageId || '').trim()
  if (normalizedPageId) {
    return {
      pageId: normalizedPageId,
      source: 'config',
    }
  }

  const normalizedPageAccessToken = String(pageAccessToken || '').trim()
  if (normalizedPageAccessToken) {
    try {
      const pageMe = await facebookApiRequest('GET', 'me', {
        fields: 'id,name,username,link',
      }, normalizedPageAccessToken)
      const detectedId = String(pageMe?.id || '').trim()
      if (detectedId) {
        return {
          pageId: detectedId,
          source: 'page_access_token',
          page: pageMe,
        }
      }
    } catch {
      // Continue with user token fallback.
    }
  }

  const normalizedAccessToken = String(accessToken || '').trim()
  if (normalizedAccessToken) {
    try {
      const accounts = await facebookApiRequest('GET', 'me/accounts', {
        fields: 'id,name,username,link,access_token',
        limit: 25,
      }, normalizedAccessToken)
      const pages = Array.isArray(accounts?.data) ? accounts.data : []
      const preferred =
        pages.find((page) => /noyecode/i.test(String(page?.name || ''))) ||
        pages.find((page) => /noyecode12/i.test(String(page?.username || ''))) ||
        pages[0]
      const detectedId = String(preferred?.id || '').trim()
      if (detectedId) {
        return {
          pageId: detectedId,
          source: 'user_access_token',
          page: preferred,
        }
      }
    } catch {
      // Fallback to public photos URL.
    }
  }

  return {
    pageId: '',
    source: 'none',
  }
}

function listPublicFacebookPagePhotos(pagePhotosUrl, limit = 10) {
  return new Promise((resolve, reject) => {
    if (!pagePhotosUrl) {
      resolve([])
      return
    }

    const url = new URL(pagePhotosUrl)
    const request = https.request(url, {
      method: 'GET',
      timeout: 15000,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    }, (response) => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        raw += chunk
      })
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`No se pudo leer la pagina publica de Facebook. HTTP ${response.statusCode}`))
          return
        }

        const matches = [
          ...(raw.match(/https:\\\/\\\/scontent[^"'\\<\s]+/g) || []),
          ...(raw.match(/https:\/\/scontent[^"'\\<\s]+/g) || []),
        ]

        const urls = [...new Set(
          matches
            .map((value) => String(value || '').replace(/\\\//g, '/').replace(/&amp;/g, '&'))
            .filter((value) => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(value))
        )].slice(0, limit)

        resolve(urls.map((imageUrl, index) => ({
          id: `public-photo-${index + 1}`,
          name: `Foto publica ${index + 1}`,
          picture: imageUrl,
          imageUrl,
          createdTime: '',
          link: pagePhotosUrl,
        })))
      })
    })

    request.on('timeout', () => {
      request.destroy(new Error('timeout'))
    })
    request.on('error', reject)
    request.end()
  })
}

function extractFacebookImagesFromAttachments(attachments = [], pagePhotosUrl = '', limit = 10) {
  const imageMap = new Map()

  const pushImage = (candidate = {}, fallbackName = 'Publicacion de Facebook', fallbackCreatedTime = '') => {
    const mediaType = String(candidate?.media_type || '').trim().toLowerCase()
    if (mediaType && mediaType !== 'photo' && mediaType !== 'album') {
      return
    }

    const imageUrl = String(
      candidate?.media?.image?.src ||
      candidate?.media?.source ||
      candidate?.url ||
      candidate?.unshimmed_url ||
      ''
    ).trim()

    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return

    const targetId = String(candidate?.target?.id || candidate?.media?.target?.id || imageUrl).trim()
    if (imageMap.has(targetId)) return

    imageMap.set(targetId, {
      id: targetId,
      name: String(candidate?.title || fallbackName).trim() || fallbackName,
      picture: imageUrl,
      imageUrl,
      createdTime: String(candidate?.created_time || fallbackCreatedTime || '').trim(),
      link: String(candidate?.url || pagePhotosUrl).trim() || pagePhotosUrl,
    })
  }

  const visitAttachment = (attachment, fallbackName, fallbackCreatedTime) => {
    pushImage(attachment, fallbackName, fallbackCreatedTime)
    const subattachments = Array.isArray(attachment?.subattachments?.data) ? attachment.subattachments.data : []
    for (const item of subattachments) {
      pushImage(item, fallbackName, fallbackCreatedTime)
    }
  }

  for (const post of attachments) {
    const fallbackName = String(post?.message || 'Publicacion de Facebook').trim().slice(0, 80) || 'Publicacion de Facebook'
    const fallbackCreatedTime = String(post?.created_time || '').trim()
    const items = Array.isArray(post?.attachments?.data) ? post.attachments.data : []
    for (const item of items) {
      visitAttachment(item, fallbackName, fallbackCreatedTime)
    }
  }

  return Array.from(imageMap.values()).slice(0, limit)
}

function extractFacebookImagesFromPosts(posts = [], pagePhotosUrl = '', limit = 10) {
  const imageMap = new Map()

  for (const post of Array.isArray(posts) ? posts : []) {
    const attachmentItems = Array.isArray(post?.attachments?.data) ? post.attachments.data : []
    const hasVideoAttachment = attachmentItems.some((item) => {
      const mediaType = String(item?.media_type || '').trim().toLowerCase()
      return mediaType.includes('video')
    })
    const postType = String(post?.type || '').trim().toLowerCase()
    if (hasVideoAttachment || postType.includes('video')) {
      continue
    }

    const imageUrl = String(post?.full_picture || '').trim()
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
      continue
    }

    const postId = String(post?.id || imageUrl).trim()
    if (imageMap.has(postId)) {
      continue
    }

    imageMap.set(postId, {
      id: postId,
      name: String(post?.message || 'Publicacion de Facebook').trim().slice(0, 80) || 'Publicacion de Facebook',
      picture: imageUrl,
      imageUrl,
      createdTime: String(post?.created_time || '').trim(),
      link: String(post?.permalink_url || pagePhotosUrl).trim() || pagePhotosUrl,
    })
  }

  return Array.from(imageMap.values()).slice(0, limit)
}

function sortFacebookPhotosByNewest(items = []) {
  return [...items].sort((a, b) => {
    const timeA = Date.parse(String(a?.createdTime || ''))
    const timeB = Date.parse(String(b?.createdTime || ''))
    const safeA = Number.isFinite(timeA) ? timeA : 0
    const safeB = Number.isFinite(timeB) ? timeB : 0
    return safeB - safeA
  })
}

function mergeFacebookPhotoLists(...lists) {
  const merged = new Map()
  for (const list of lists) {
    for (const item of Array.isArray(list) ? list : []) {
      const key = String(item?.id || item?.link || item?.imageUrl || item?.picture || '').trim()
      if (!key) continue
      const current = merged.get(key)
      if (!current) {
        merged.set(key, item)
        continue
      }

      const currentTime = Date.parse(String(current?.createdTime || ''))
      const nextTime = Date.parse(String(item?.createdTime || ''))
      const safeCurrent = Number.isFinite(currentTime) ? currentTime : 0
      const safeNext = Number.isFinite(nextTime) ? nextTime : 0
      if (safeNext > safeCurrent) {
        merged.set(key, { ...current, ...item })
      } else {
        merged.set(key, { ...item, ...current })
      }
    }
  }
  return sortFacebookPhotosByNewest(Array.from(merged.values()))
}

async function listFacebookPagePhotos(options = {}) {
  const env = getProjectEnv()
  const hasOwnOption = (key) => Object.prototype.hasOwnProperty.call(options, key)
  const limit = Number(options?.limit) > 0 ? Math.min(Number(options.limit), 10) : 10
  const fetchLimit = Math.max(limit * 3, 20)
  const configuredPageId = String(
    hasOwnOption('pageId')
      ? options.pageId
      : (
        env.FB_PAGE_ID ||
        env.FACEBOOK_PAGE_ID ||
        env.META_PAGE_ID ||
        ''
      )
  ).trim()
  const pagePhotosUrl = String(hasOwnOption('pagePhotosUrl') ? options.pagePhotosUrl : getFacebookPagePhotosUrl()).trim()
  const pageAccessToken = String(
    hasOwnOption('pageAccessToken')
      ? options.pageAccessToken
      : (env.FB_PAGE_ACCESS_TOKEN || env.FACEBOOK_PAGE_ACCESS_TOKEN || '')
  ).trim()
  const tokenSource = hasOwnOption('accessToken')
    ? options.accessToken
    : (
      env.FB_ACCESS_TOKEN ||
      env.FACEBOOK_ACCESS_TOKEN ||
      ''
    )
  const token = String(tokenSource || '').trim()
  const resolvedPage = await resolveFacebookPageIdentity({
    pageId: configuredPageId,
    accessToken: token,
    pageAccessToken,
  })
  const pageId = String(resolvedPage?.pageId || '').trim()

  let postImages = []
  const graphToken = pageAccessToken || token

  if (graphToken && pageId) {
    try {
      const postsResponse = await facebookApiRequest('GET', `${pageId}/published_posts`, {
        fields: 'id,message,created_time,attachments{media_type,media,url,subattachments,target,title,unshimmed_url}',
        limit: fetchLimit,
      }, graphToken)

      postImages = extractFacebookImagesFromAttachments(
        Array.isArray(postsResponse?.data) ? postsResponse.data : [],
        pagePhotosUrl,
        fetchLimit
      )
    } catch {
      postImages = []
    }
  }

  let feedPostImages = []
  if (graphToken && pageId) {
    try {
      const feedResponse = await facebookApiRequest('GET', `${pageId}/posts`, {
        fields: 'id,message,created_time,full_picture,permalink_url,type,attachments{media_type}',
        limit: fetchLimit,
      }, graphToken)

      feedPostImages = extractFacebookImagesFromPosts(
        Array.isArray(feedResponse?.data) ? feedResponse.data : [],
        pagePhotosUrl,
        fetchLimit
      )
    } catch {
      feedPostImages = []
    }
  }

  let uploadedPhotos = []
  if (graphToken && pageId) {
    try {
      const response = await facebookApiRequest('GET', `${pageId}/photos`, {
        type: 'uploaded',
        fields: 'id,name,picture,images,created_time,link',
        limit: fetchLimit,
      }, graphToken)

      const rawPhotos = Array.isArray(response?.data) ? response.data : []
      uploadedPhotos = rawPhotos.map((photo) => {
        const images = Array.isArray(photo?.images) ? photo.images : []
        const bestImage = images[0] || {}
        return {
          id: String(photo?.id || '').trim(),
          name: String(photo?.name || '').trim() || `Foto ${String(photo?.id || '').slice(0, 8)}`,
          picture: String(photo?.picture || bestImage?.source || '').trim(),
          imageUrl: String(bestImage?.source || photo?.picture || '').trim(),
          createdTime: String(photo?.created_time || '').trim(),
          link: String(photo?.link || '').trim(),
        }
      }).filter((photo) => photo.id && (photo.imageUrl || photo.picture))
    } catch {
      uploadedPhotos = []
    }
  }

  const graphPhotos = mergeFacebookPhotoLists(uploadedPhotos, postImages, feedPostImages).slice(0, limit)
  if (graphPhotos.length > 0) {
    return graphPhotos
  }

  if (!pageId && !pagePhotosUrl) {
    return []
  }

  const publicPhotos = await listPublicFacebookPagePhotos(pagePhotosUrl, limit).catch(() => [])
  if (publicPhotos.length > 0) {
    return publicPhotos
  }

  return []
}

function validateMetaToken(token) {
  return new Promise((resolve) => {
    if (!token) {
      resolve({
        ok: false,
        reason: 'No hay token configurado en FB_ACCESS_TOKEN, FACEBOOK_ACCESS_TOKEN o META_ACCESS_TOKEN.',
      })
      return
    }

    const url = new URL('https://graph.facebook.com/v22.0/me/adaccounts')
    url.searchParams.set('limit', '1')
    url.searchParams.set('fields', 'id,name')
    url.searchParams.set('access_token', token)

    const request = https.get(
      url,
      {
        timeout: 8000,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'noyecode-facebook-ads-preflight/1.0',
        },
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => {
          try {
            const data = body ? JSON.parse(body) : {}
            if (response.statusCode >= 200 && response.statusCode < 300 && !data.error) {
              const count = Array.isArray(data.data) ? data.data.length : 0
              resolve({
                ok: true,
                reason: count > 0
                  ? `Token valido. Meta devolvio ${count} cuenta(s) en la verificacion rapida.`
                  : 'Token valido. La verificacion contra Meta respondio correctamente.',
              })
              return
            }

            const message = data?.error?.message || `HTTP ${response.statusCode}`
            resolve({
              ok: false,
              reason: `Meta rechazo la verificacion del token: ${message}`,
            })
          } catch (error) {
            resolve({
              ok: false,
              reason: `No se pudo interpretar la respuesta de Meta: ${error.message || error}`,
            })
          }
        })
      }
    )

    request.on('timeout', () => {
      request.destroy(new Error('timeout'))
    })

    request.on('error', (error) => {
      resolve({
        ok: false,
        reason: `No se pudo verificar Meta Graph API: ${error.message || error}`,
      })
    })
  })
}

function facebookApiRequest(method, pathName, params = {}, token = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://graph.facebook.com/v22.0/${pathName.replace(/^\/+/, '')}`)
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'noyecode-facebook-ads-mcp/1.0',
    }

    let body = null
    if (method === 'GET') {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value))
        }
      }
      if (token) {
        url.searchParams.set('access_token', token)
      }
    } else {
      const form = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          form.set(key, typeof value === 'string' ? value : JSON.stringify(value))
        }
      }
      if (token) {
        form.set('access_token', token)
      }
      body = form.toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      headers['Content-Length'] = Buffer.byteLength(body)
    }

    const request = https.request(
      url,
      { method, timeout: 15000, headers },
      (response) => {
        let raw = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          raw += chunk
        })
        response.on('end', () => {
          try {
            const data = raw ? JSON.parse(raw) : {}
            if (response.statusCode >= 200 && response.statusCode < 300 && !data.error) {
              resolve(data)
              return
            }
            const errorMessage = [
              data?.error?.message || `HTTP ${response.statusCode}`,
              data?.error?.error_user_title ? `title=${data.error.error_user_title}` : '',
              data?.error?.error_user_msg ? `detail=${data.error.error_user_msg}` : '',
              data?.error?.error_subcode ? `subcode=${data.error.error_subcode}` : '',
              `path=${pathName}`,
            ].filter(Boolean).join(' | ')
            reject(new Error(errorMessage))
          } catch (error) {
            reject(new Error(`Respuesta invalida de Meta: ${error.message || error}`))
          }
        })
      }
    )

    request.on('timeout', () => {
      request.destroy(new Error('timeout'))
    })
    request.on('error', reject)
    if (body) {
      request.write(body)
    }
    request.end()
  })
}

async function getPrimaryAdAccount(token) {
  const result = await facebookApiRequest(
    'GET',
    'me/adaccounts',
    {
      limit: 1,
      fields: 'id,account_id,name,account_status,currency',
    },
    token
  )

  const account = Array.isArray(result?.data) ? result.data[0] : null
  if (!account) {
    throw new Error('El token no devolvio cuentas publicitarias disponibles.')
  }
  return account
}

async function getAdAccountByName(token, accountHint) {
  const result = await facebookApiRequest(
    'GET',
    'me/adaccounts',
    {
      limit: 100,
      fields: 'id,account_id,name,account_status,currency',
    },
    token
  )

  const accounts = Array.isArray(result?.data) ? result.data : []
  const normalizedHint = String(accountHint || '').trim().toLowerCase()
  const exact = accounts.find((account) => String(account?.name || '').trim().toLowerCase() === normalizedHint)
  if (exact) return exact

  const partial = accounts.find((account) => String(account?.name || '').toLowerCase().includes(normalizedHint))
  if (partial) return partial

  if (accounts.length > 0) {
    throw new Error(`No encontre la cuenta publicitaria "${accountHint}" en el token actual.`)
  }
  throw new Error('El token no devolvio cuentas publicitarias disponibles.')
}

async function getAdAccountById(token, accountId) {
  const result = await facebookApiRequest(
    'GET',
    'me/adaccounts',
    {
      limit: 100,
      fields: 'id,account_id,name,account_status,currency',
    },
    token
  )

  const accounts = Array.isArray(result?.data) ? result.data : []
  const normalizedTarget = String(accountId || '').replace(/^act_/, '').trim()
  const exact = accounts.find((account) => String(account?.account_id || '').trim() === normalizedTarget)
  if (exact) return exact

  if (accounts.length > 0) {
    throw new Error(`No encontre la cuenta publicitaria con ID ${normalizedTarget} en el token actual.`)
  }
  throw new Error('El token no devolvio cuentas publicitarias disponibles.')
}

module.exports = {
  facebookApiRequest,
  validateMetaToken,
  getPrimaryAdAccount,
  getAdAccountByName,
  getAdAccountById,
  getFacebookAdsCdpInfo,
  getMetaPageId,
  getTargetAdAccountId,
  getFacebookPagePhotosUrl,
  resolveFacebookPageIdentity,
  listPublicFacebookPagePhotos,
  extractFacebookImagesFromAttachments,
  extractFacebookImagesFromPosts,
  sortFacebookPhotosByNewest,
  mergeFacebookPhotoLists,
  listFacebookPagePhotos,
}
