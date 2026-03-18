const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { spawn, exec, execFileSync } = require('child_process')
const { shell } = require('electron')
const { PROJECT_ROOT } = require('../config/project-paths')
const { getProjectEnv } = require('../utils/env')
const { sleep } = require('../utils/helpers')
const { findPython } = require('../utils/process')
const state = require('../state')
const { facebookApiRequest, validateMetaToken, getMetaPageId, getTargetAdAccountId, getFacebookAdsCdpInfo } = require('../facebook/api')
const { buildTargetingSummary } = require('./segment')
const { buildLeadTargeting, buildLeadFormSpec, toMetaMoney, toMetaDateTime } = require('./orchestrator')
const { pushMarketingBrowserEvent } = require('./monitor')
const { pushFacebookVisualEvent } = require('../facebook/visual-browser')
const { buildLeadCampaignBundleSpec, buildDraftCreativeConfig, buildDraftAdConfig } = require('./campaign-bundle')

async function runLeadCampaignBundleViaCdp(preview, orchestrator) {
  const info = getFacebookAdsCdpInfo()
  if (!info.serverExists || !info.pythonBin || !info.helperExists) {
    throw new Error('El servidor CDP no esta listo para ejecutar la creacion de la campana.')
  }

  const spec = buildLeadCampaignBundleSpec(preview, orchestrator)
  // Inject CDP port and token into the spec
  spec.cdp_port = info.cdpPort || 9225
  if (info.token) {
    spec.access_token = info.token
  }
  const payload = JSON.stringify(spec)

  return new Promise((resolve, reject) => {
    const env = {
      ...getProjectEnv(),
      FB_ACCESS_TOKEN: info.token,
    }
    const child = spawn(info.pythonBin, [info.helperPath, info.serverPath], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8')
    })

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8')
      stderr += text
      const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
      for (const line of lines) {
        emitMarketingUpdate({
          type: 'log',
          status: 'running',
          line,
          summary: 'CDP esta ejecutando el bundle de Meta Ads.',
        })
      }
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      let parsed = null
      try {
        parsed = stdout.trim() ? JSON.parse(stdout.trim()) : null
      } catch (error) {
        reject(new Error(`El runner CDP devolvio JSON invalido: ${error.message || error}`))
        return
      }

      if (code !== 0 || parsed?.ok === false) {
        reject(new Error(parsed?.error || stderr.trim() || `El runner CDP finalizo con codigo ${code}`))
        return
      }

      resolve(parsed)
    })

    child.stdin.write(payload)
    child.stdin.end()
  })
}

// ─── n8n Campaign Creation (legacy — kept for compatibility) ────────────

async function runLeadCampaignBundleViaN8n(preview, orchestrator) {
  const env = getProjectEnv()
  const webhookUrl = String(env.N8N_WEBHOOK_CREAR_CAMPANA_FB || '').trim()
  if (!webhookUrl) {
    throw new Error('No se configuro N8N_WEBHOOK_CREAR_CAMPANA_FB en .env')
  }

  const spec = buildLeadCampaignBundleSpec(preview, orchestrator)
  // n8n Parse & Validate requires access_token in the spec
  spec.access_token = String(env.FB_ACCESS_TOKEN || '').trim()
  const imagePath = String(spec.creative?.image_path || '').trim()

  // Build multipart payload: JSON spec + image file
  const boundary = `----NoyeCampaignBoundary${Date.now().toString(16)}`
  const chunks = []

  // Add JSON spec as field
  chunks.push(Buffer.from(`--${boundary}\r\n`))
  chunks.push(Buffer.from('Content-Disposition: form-data; name="spec"\r\nContent-Type: application/json\r\n\r\n'))
  chunks.push(Buffer.from(JSON.stringify(spec)))
  chunks.push(Buffer.from('\r\n'))

  // Add image file if exists
  if (imagePath && fs.existsSync(imagePath)) {
    const fileName = path.basename(imagePath)
    const ext = path.extname(imagePath).toLowerCase()
    const contentType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
    const fileContent = fs.readFileSync(imagePath)
    chunks.push(Buffer.from(`--${boundary}\r\n`))
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="image"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`))
    chunks.push(fileContent)
    chunks.push(Buffer.from('\r\n'))
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  const body = Buffer.concat(chunks)

  const parsedUrl = new URL(webhookUrl)
  const httpModule = parsedUrl.protocol === 'https:' ? https : http

  return new Promise((resolve, reject) => {
    const request = httpModule.request(parsedUrl, {
      method: 'POST',
      timeout: 120000,
      headers: {
        Accept: 'application/json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'User-Agent': 'noyecode-marketing-gui/1.0',
      },
    }, (response) => {
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
          reject(new Error(data?.error?.message || data?.error || `HTTP ${response.statusCode}: ${raw.slice(0, 300)}`))
        } catch (error) {
          reject(new Error(`Respuesta invalida de n8n: ${error.message || error}`))
        }
      })
    })

    request.on('timeout', () => request.destroy(new Error('timeout: n8n no respondio en 120s')))
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

function postMultipartForm(url, fields = {}, files = {}, headers = {}) {
  return new Promise((resolve, reject) => {
    const boundary = `----NoyeBoundary${Date.now().toString(16)}`
    const chunks = []

    for (const [key, value] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\n`))
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`))
      chunks.push(Buffer.from(String(value)))
      chunks.push(Buffer.from('\r\n'))
    }

    for (const [key, file] of Object.entries(files)) {
      if (!file?.path) continue
      const fileName = path.basename(file.path)
      const fileContent = fs.readFileSync(file.path)
      chunks.push(Buffer.from(`--${boundary}\r\n`))
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"; filename="${fileName}"\r\n`))
      chunks.push(Buffer.from(`Content-Type: ${file.contentType || 'application/octet-stream'}\r\n\r\n`))
      chunks.push(fileContent)
      chunks.push(Buffer.from('\r\n'))
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`))
    const body = Buffer.concat(chunks)

    const request = https.request(url, {
      method: 'POST',
      timeout: 30000,
      headers: {
        Accept: 'application/json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'User-Agent': 'noyecode-facebook-ads-mcp/1.0',
        ...headers,
      },
    }, (response) => {
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
          reject(new Error(data?.error?.message || `HTTP ${response.statusCode}`))
        } catch (error) {
          reject(new Error(`Respuesta invalida de Meta: ${error.message || error}`))
        }
      })
    })

    request.on('timeout', () => request.destroy(new Error('timeout')))
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

async function uploadAdImage(accountNode, imagePath, token) {
  const url = new URL(`https://graph.facebook.com/v22.0/${String(accountNode || '').replace(/^\/+/, '')}/adimages`)
  return postMultipartForm(
    url,
    { access_token: token },
    {
      filename: {
        path: imagePath,
        contentType: 'image/png',
      },
    }
  )
}

async function createAdCreativeOnMeta(preview, creation, token) {
  const accountNode = String(creation?.account?.id || '').trim()
  const imagePath = String(preview?.creativeDraftConfig?.imageAssetPath || '').trim()
  const objectStorySpec = preview?.creativeDraftConfig?.objectStorySpec
  if (!accountNode || !imagePath || !objectStorySpec) {
    throw new Error('No tengo datos suficientes para crear el creative en Meta.')
  }

  let upload
  try {
    upload = await uploadAdImage(accountNode, imagePath, token)
  } catch (error) {
    throw new Error(`Fallo subiendo imagen a ${accountNode} | file=${path.basename(imagePath)} | ${error.message || error}`)
  }
  const imageHash = upload?.images
    ? Object.values(upload.images)[0]?.hash || ''
    : upload?.hash || ''

  if (!imageHash) {
    throw new Error('Meta no devolvio image_hash al subir la imagen.')
  }

  const storySpec = JSON.parse(JSON.stringify(objectStorySpec))
  if (storySpec?.link_data) {
    storySpec.link_data.image_hash = imageHash
  }

  const creativeName = `Creative Borrador | ${preview.creativeDraftConfig.leadgenFormId}`
  let created
  try {
    created = await facebookApiRequest(
      'POST',
      `${accountNode}/adcreatives`,
      {
        name: creativeName,
        object_story_spec: storySpec,
      },
      token
    )
  } catch (error) {
    throw new Error(
      `Fallo creando adcreative en ${accountNode} | form_id=${preview.creativeDraftConfig.leadgenFormId} | cta=${preview.creativeDraftConfig.callToActionType} | ${error.message || error}`
    )
  }

  return {
    imageHash,
    creativeId: created?.id || '',
    creativeName,
  }
}

async function createAdOnMeta(preview, creation, creative, token) {
  const accountNode = String(creation?.account?.id || '').trim()
  const adsetId = String(creation?.adsetId || '').trim()
  const creativeId = String(creative?.creativeId || '').trim()
  const adName = String(preview?.adDraftConfig?.adName || '').trim()
  if (!accountNode || !adsetId || !creativeId || !adName) {
    throw new Error('No tengo datos suficientes para crear el anuncio en Meta.')
  }

  let created
  try {
    created = await facebookApiRequest(
      'POST',
      `${accountNode}/ads`,
      {
        name: adName,
        adset_id: adsetId,
        creative: { creative_id: creativeId },
        status: 'PAUSED',
      },
      token
    )
  } catch (error) {
    throw new Error(
      `Fallo creando ad en ${accountNode} | adset_id=${adsetId} | creative_id=${creativeId} | ${error.message || error}`
    )
  }

  return {
    adId: created?.id || '',
    adName,
  }
}

function validateFacebookAdsCdpRuntime(info) {
  if (!info?.pythonBin || !info?.serverPath || !info?.helperPath) {
    return {
      ok: false,
      reason: 'No tengo suficientes datos para validar el runtime CDP.',
    }
  }

  try {
    execFileSync(
      info.pythonBin,
      [
        '-c',
        [
          'import importlib.util',
          'from pathlib import Path',
          'import json, urllib.request',
          `assert Path(${JSON.stringify(info.serverPath)}).exists()`,
          `assert Path(${JSON.stringify(info.helperPath)}).exists()`,
          'print("ok")',
        ].join('; '),
      ],
      {
        cwd: PROJECT_ROOT,
        timeout: 10000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    return {
      ok: true,
      reason: 'Python puede importar las dependencias base del servidor CDP.',
    }
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim()
    return {
      ok: false,
      reason: `Python no puede cargar el runtime CDP: ${detail}`,
    }
  }
}

async function runFacebookAdsCdpPreflight() {
  const env = getProjectEnv()
  const info = getFacebookAdsCdpInfo()
  const issues = []

  if (!info.serverExists) {
    issues.push(`No existe el servidor CDP en ${info.serverPath}`)
  }
  if (!info.helperExists) {
    issues.push(`No existe el runner CDP en ${info.helperPath}`)
  }
  if (!info.pythonBin) {
    issues.push('Python no esta disponible en PATH para ejecutar el servidor CDP.')
  }
  if (!info.token) {
    issues.push('No existe token de Meta Ads en variables de entorno.')
  }

  let tokenValidation = {
    ok: false,
    reason: 'No se ejecuto validacion remota del token.',
  }
  let runtimeValidation = {
    ok: false,
    reason: 'No se ejecuto validacion local del runtime CDP.',
  }

  if (info.serverExists && info.helperExists && info.pythonBin) {
    runtimeValidation = validateFacebookAdsCdpRuntime(info)
    if (!runtimeValidation.ok) {
      issues.push(runtimeValidation.reason)
    }
  }

  if (info.serverExists && info.helperExists && info.pythonBin && info.token) {
    tokenValidation = await validateMetaToken(info.token)
    if (!tokenValidation.ok) {
      issues.push(tokenValidation.reason)
    }
  }

  return {
    ready: issues.length === 0,
    issues,
    tokenValidation,
    details: {
      serverPath: info.serverPath,
      serverExists: info.serverExists,
      helperPath: info.helperPath,
      helperExists: info.helperExists,
      pythonBin: info.pythonBin || '',
      hasToken: Boolean(info.token),
      businessWebsite: env.BUSINESS_WEBSITE || 'noyecode.com',
      runtimeValidation,
    },
  }
}

function emitMarketingUpdate(update) {
  if (state.mainWindow) {
    state.mainWindow.webContents.send('marketing-run-update', update)
  }
  pushMarketingBrowserEvent(update)
  void pushFacebookVisualEvent(update)
}

async function openMetaAdsManager(creation = null) {
  const accountId = String(creation?.account?.account_id || '').replace(/^act_/, '').trim()
  const campaignId = String(creation?.campaignId || '').trim()
  const targetUrl =
    accountId && campaignId
      ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns/edit/standalone?act=${encodeURIComponent(accountId)}&selected_campaign_ids=${encodeURIComponent(campaignId)}`
      : accountId
        ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(accountId)}`
        : 'https://adsmanager.facebook.com/'
  try {
    if (state.facebookVisualPage && !state.facebookVisualPage.isClosed()) {
      await state.facebookVisualPage.bringToFront()
      await state.facebookVisualPage.goto(targetUrl, { waitUntil: 'domcontentloaded' })
    } else {
      await shell.openExternal(targetUrl)
    }
    return { ok: true, url: targetUrl }
  } catch (error) {
    return {
      ok: false,
      url: targetUrl,
      reason: error?.message || String(error),
    }
  }
}

function buildCampaignProcess(preflight, preview, creation = null, orchestrator = null) {
  const contactMode = String(preview?.contactMode || '').trim()
  const usesWhatsapp = contactMode === 'whatsapp'
  const ready = Boolean(preflight?.ready)
  const issuesText = Array.isArray(preflight?.issues) && preflight.issues.length > 0
    ? preflight.issues.join(' | ')
    : 'Sin observaciones.'
  const created = Boolean(creation?.campaignId)
  const adsetCreated = Boolean(creation?.adsetId)
  const adsetDeferredToUi = Boolean(creation?.adsetDeferredToUi)
  const adsetError = String(creation?.adsetError || '').trim()
  const formsFound = Array.isArray(preview?.leadgenForms) ? preview.leadgenForms.length : 0
  const formsLoaded = Boolean(preview?.leadgenFormsLoaded)
  const selectedLeadgenFormId = String(preview?.selectedLeadgenFormId || '').trim()
  const creativeDraftReady = Boolean(preview?.creativeDraftConfig?.leadgenFormId)
  const creativeCreated = Boolean(preview?.metaCreative?.creativeId)
  const adDraftReady = Boolean(preview?.adDraftConfig?.adsetId)
  const adCreated = Boolean(preview?.metaAd?.adId)
  const hasOrchestrator = Boolean(orchestrator?.plan)
  const qaApproved = Boolean(orchestrator?.marketing?.status)
  const copySummary = orchestrator?.adsAnalyst?.hook || 'Pendiente de brief del ads-analyst.'
    const creativeSummary = orchestrator?.imageCreator?.dimensions
    ? `${orchestrator.imageCreator.style} | ${orchestrator.imageCreator.dimensions}`
    : 'Pendiente de direccion visual.'
  const qaSummary = orchestrator?.marketing?.verdict || 'Pendiente de revision del agente marketing.'

  return [
    {
      id: 'orchestrator-plan',
      title: 'Plan del orquestador',
      detail: hasOrchestrator
        ? `${orchestrator.plan.task} Agentes: orchestrator -> ads-analyst -> image-creator -> marketing.`
        : 'Pendiente de coordinacion del orquestador.',
      status: hasOrchestrator ? 'success' : 'warning',
    },
    {
      id: 'ads-analyst',
      title: 'Brief del ads-analyst',
      detail: hasOrchestrator
        ? `Hook: ${copySummary}`
        : 'Pendiente de brief publicitario.',
      status: hasOrchestrator ? 'success' : 'warning',
    },
    {
      id: 'image-creator',
      title: 'Orden al image-creator',
      detail: hasOrchestrator
        ? `Direccion visual preparada: ${creativeSummary}.`
        : 'Pendiente de prompt visual.',
      status: hasOrchestrator ? 'success' : 'warning',
    },
    {
      id: 'marketing-qa',
      title: 'Revision del agente marketing',
      detail: qaApproved
        ? `${qaSummary}. ${orchestrator.marketing.notes.join(' ')}`
        : 'Pendiente de validacion de marketing.',
      status: qaApproved ? 'success' : 'warning',
    },
    {
      id: 'preflight',
      title: 'Preflight del CDP',
      detail: ready
        ? 'Servidor CDP detectado, Python disponible y token validado contra Meta.'
        : `Faltan requisitos: ${issuesText}`,
      status: ready ? 'success' : 'warning',
    },
    {
      id: 'account',
      title: 'Seleccion de cuenta publicitaria',
      detail: created
        ? `Cuenta seleccionada: ${creation.account?.name || creation.account?.id || 'Sin nombre'}`
        : ready
        ? 'Listo para consultar cuentas publicitarias disponibles con list_ad_accounts.'
        : 'Bloqueado hasta completar el preflight.',
      status: created ? 'success' : ready ? 'pending' : 'warning',
    },
    {
      id: 'campaign',
      title: 'Creacion de campana',
      detail: created
        ? `Campana borrador creada en Meta con ID ${creation.campaignId}. Nombre: ${creation.campaignName}.`
        : `Se crearia una campana con objetivo ${preview.objective} para ${preview.country}.`,
      status: created ? 'success' : ready ? 'pending' : 'warning',
    },
    {
      id: 'adset',
      title: 'Creacion del conjunto de anuncios',
      detail: adsetCreated
        ? `Ad set borrador creado con ID ${creation.adsetId}. Presupuesto maximo ${preview.budget}. Publico base temporal: ${creation.targetingSummary}.`
        : adsetDeferredToUi
        ? 'Meta exigio seleccionar manualmente un objeto promocionado valido; el flujo visual en Ads Manager terminara este paso.'
        : adsetError
        ? `El CDP devolvio un error al crear el ad set: ${adsetError}`
        : `Se configuraria presupuesto ${preview.budget} y fechas ${preview.startDate} -> ${preview.endDate}.`,
      status: adsetCreated ? 'success' : adsetDeferredToUi ? 'warning' : adsetError ? 'error' : ready ? 'pending' : 'warning',
    },
    {
      id: 'leadgen-form',
      title: usesWhatsapp ? 'Canal de contacto' : 'Consulta de formularios Instant Form',
      detail: usesWhatsapp
        ? 'El usuario selecciono WhatsApp. El agente deja copy, publico sugerido y prompt visual listos, pero el workflow actual de n8n aun automatiza formularios instantaneos.'
        : formsLoaded
          ? formsFound > 0
            ? selectedLeadgenFormId
              ? `Se encontraron ${formsFound} formulario(s) y se selecciono ${preview.selectedLeadgenFormName} (${selectedLeadgenFormId}).`
              : `Se encontraron ${formsFound} formulario(s), pero ninguno cumple exacto con los campos requeridos.`
            : `No se encontraron formularios en la pagina ${orchestrator?.execution?.pageId || getMetaPageId()}.`
          : `Se consultarian los formularios de la pagina ${orchestrator?.execution?.pageId || getMetaPageId()} para obtener el leadgen_form_id.`,
      status: usesWhatsapp ? 'warning' : formsLoaded ? (formsFound > 0 ? 'success' : 'warning') : ready ? 'pending' : 'warning',
    },
    {
      id: 'creative',
      title: 'Creacion del creativo',
      detail: hasOrchestrator
        ? creativeCreated
          ? `Creative real creado en Meta con ID ${preview.metaCreative.creativeId} e image_hash ${preview.metaCreative.imageHash}.`
          : creativeDraftReady
          ? `Payload del creativo listo con CTA "${orchestrator.adsAnalyst.cta}", leadgen_form_id ${selectedLeadgenFormId} e imagen ${path.basename(preview.creativeDraftConfig.imageAssetPath)}.`
          : `Brief listo para creativo con CTA "${orchestrator.adsAnalyst.cta}", URL ${preview.url} y formulario ${preview.formFields.join(', ')}.${selectedLeadgenFormId ? ` leadgen_form_id seleccionado: ${selectedLeadgenFormId}.` : ''}`
        : `Se asociaria la URL ${preview.url} y el formulario ${preview.formFields.join(', ')}.`,
      status: creativeCreated || creativeDraftReady ? 'success' : hasOrchestrator && ready ? 'pending' : 'warning',
    },
    {
      id: 'ad',
      title: 'Creacion del anuncio',
      detail: hasOrchestrator
        ? adCreated
          ? `Anuncio real creado en Meta con ID ${preview.metaAd.adId} en estado PAUSED.`
          : adDraftReady
          ? `Payload del anuncio listo en PAUSED para el ad set ${preview.adDraftConfig.adsetId}. Falta subir la imagen a Meta para crear el creative real.`
          : creativeDraftReady
            ? 'El anuncio ya tiene configurado el leadgen_form_id, el object_story_spec base y la imagen local preparada; falta subir el asset a Meta.'
            : 'El orquestador dejo listo el paquete de copy, prompt visual y QA; falta material visual final y leadgen_form_id para enlazar el anuncio.'
        : 'Se enlazarian campana, ad set y creativo en un anuncio listo para revision/publicacion.',
      status: adCreated || adDraftReady || creativeDraftReady ? 'success' : hasOrchestrator && ready ? 'pending' : 'warning',
    },
    {
      id: 'publish',
      title: 'Revision final y publicacion',
      detail: ready
        ? 'El siguiente paso seria ejecutar la creacion real y validar la respuesta de Meta Ads.'
        : 'Pendiente hasta habilitar credenciales y preflight completo.',
      status: ready ? 'pending' : 'warning',
    },
  ]
}

/**
 * Detect external job_poller.py processes (not started by this GUI).
 * Returns array of PIDs running job_poller.py.
 */
function findPollerPids() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*job_poller*\' -and $_.Name -like \'*python*\' } | Select-Object -ExpandProperty ProcessId"',
        { timeout: 8000 },
        (err, stdout) => {
          if (err || !stdout.trim()) return resolve([])
          const pids = stdout.trim().split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(n => n > 0)
          resolve(pids)
        }
      )
    } else {
      exec("pgrep -f 'job_poller\\.py'", { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout.trim()) return resolve([])
        const pids = stdout.trim().split(/\n/).map(s => parseInt(s.trim(), 10)).filter(n => n > 0)
        resolve(pids)
      })
    }
  })
}

/**
 * Check if the poller is running — either our child or an external process.
 */
async function isPollerAlive() {
  // Check our own child first
  if (state.pollerProcess && state.pollerProcess.exitCode === null) {
    return { running: true, source: 'gui', pids: [state.pollerProcess.pid] }
  }
  // Check for external poller processes
  const externalPids = await findPollerPids()
  if (externalPids.length > 0) {
    return { running: true, source: 'external', pids: externalPids }
  }
  return { running: false, source: null, pids: [] }
}

module.exports = {
  runLeadCampaignBundleViaCdp,
  runLeadCampaignBundleViaN8n,
  postMultipartForm,
  uploadAdImage,
  createAdCreativeOnMeta,
  createAdOnMeta,
  validateFacebookAdsCdpRuntime,
  runFacebookAdsCdpPreflight,
  emitMarketingUpdate,
  openMetaAdsManager,
  buildCampaignProcess,
  findPollerPids,
  isPollerAlive,
}
