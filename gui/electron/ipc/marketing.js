const fs = require('fs')
const os = require('os')
const path = require('path')
const { getProjectEnv } = require('../utils/env')
const { ensureAbsoluteUrl, sleep } = require('../utils/helpers')
const state = require('../state')
const { PROJECT_ROOT } = require('../config/project-paths')
const { lookupCompanyData } = require('../data/lookup')
const { getMarketingContactModeConfig, buildMarketingSegmentFromPreview } = require('../services/segment')
const { runLocalMarketingOrchestrator } = require('../services/orchestrator')
const { getMarketingImagesDir, prepareLatestMarketingImageAsset } = require('../services/image-asset')
const { generateMarketingImageAsset } = require('../services/image-generation')
const { IMAGE_FORMATS } = require('../config/image-formats')
const { openMarketingBrowserMonitor } = require('../services/monitor')
const { listFacebookPagePhotos } = require('../facebook/api')
const {
  emitMarketingUpdate,
  openMetaAdsManager,
  buildCampaignProcess,
} = require('../services/campaign-process')

function exportMarketingAssetToDownloads(preview) {
  const sourcePath = String(
    preview?.imageAsset?.preparedPath ||
    preview?.imageAsset?.sourcePath ||
    ''
  ).trim()
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return ''
  }

  const downloadsDir = path.join(os.homedir(), 'Downloads')
  fs.mkdirSync(downloadsDir, { recursive: true })

  const sourceExt = path.extname(sourcePath) || '.png'
  const sourceBase = path.basename(sourcePath, sourceExt) || 'campana_marketing'
  const targetPath = path.join(downloadsDir, `${sourceBase}${sourceExt}`)
  if (sourcePath !== targetPath) {
    fs.copyFileSync(sourcePath, targetPath)
  }
  return targetPath
}

// reopenCampaignAndVerifyAdUi — removed: UI automation replaced by Meta API REST
async function _unused_reopenCampaignAndVerifyAdUi(preview, creationState) {
  const browserOpen = await openMetaAdsManager(creationState)
  emitMarketingUpdate({
    type: 'log',
    line: browserOpen.ok
      ? `[OPEN] Navegador abierto en ${browserOpen.url} para visualizar Meta Ads Manager.`
      : `[OPEN] No se pudo abrir el navegador automaticamente: ${browserOpen.reason}`,
  })
  await sleep(650)

  let campaignEditorState = { nameFilled: false, budgetConfigured: false, nextClicked: false }
  let adsetUiState = {
    anySuccess: false,
    conversionConfigured: false,
    performanceConfigured: false,
    scheduleConfigured: false,
    nextClicked: false,
    visibleSections: [],
    canAdvance: false,
  }
  let adUiState = {
    reachedEditor: false,
    nameFilled: false,
    imageConfigured: false,
    primaryTextConfigured: false,
    headlineConfigured: false,
    descriptionConfigured: false,
    ctaConfigured: false,
    leadFormConfigured: false,
    visibleSections: [],
    canFinalize: false,
  }

  if (!browserOpen.ok) {
    return { browserOpen, campaignEditorState, adsetUiState, adUiState, uiIncomplete: false }
  }

  emitMarketingUpdate({
    type: 'log',
    status: 'running',
    line: creationState?.campaignId
      ? `[FACEBOOK-UI] La campaña ya fue creada (${creationState.campaignId}). Reabrire el editor del anuncio para verificar textos, multimedia y reemplazar la imagen antes de finalizar.`
      : '[FACEBOOK-UI] Intentare abrir el listado de campañas y reabrir la campaña por nombre para verificar el anuncio antes de finalizar.',
  })
  await sleep(450)

  if (creationState?.campaignId) {
    emitMarketingUpdate({
      type: 'log',
      status: 'running',
      line: '[FACEBOOK-UI] La campaña ya existe; omitire cambios de nombre, presupuesto y conjunto. Ire directo al anuncio para reemplazar la imagen en Contenido multimedia.',
    })
    await sleep(450)
  } else {
    const openedFromList = await tryFacebookUiOpenCampaignFromList(preview)
    if (!openedFromList) {
      const createdFromUi = await tryFacebookUiCreateCampaign(preview)
      if (!createdFromUi) {
        emitMarketingUpdate({
          type: 'log',
          status: 'warning',
          line: '[FACEBOOK-UI] No pude abrir la campaña creada desde el listado. Intentare completar lo visible del editor actual.',
        })
        await sleep(450)
      }
    } else {
      emitMarketingUpdate({
        type: 'log',
        status: 'running',
        line: '[FACEBOOK-UI] La campaña creada por n8n fue localizada en el listado y reabierta para ajustar el anuncio.',
      })
      await sleep(450)
    }
    campaignEditorState = await tryFacebookUiConfigureCampaignEditor(preview)
  }

  if (campaignEditorState.nextClicked) {
    adsetUiState = await tryFacebookUiConfigureAdsetSchedule(preview)
    if (adsetUiState.nextClicked) {
      adUiState = await tryFacebookUiReachAdEditor(preview)
    } else {
      emitMarketingUpdate({
        type: 'log',
        status: 'warning',
        line: '[FACEBOOK-UI] No pasare al apartado de anuncio porque el conjunto de anuncios todavia no quedo completo o no se pudo pulsar Siguiente.',
      })
      await sleep(450)
    }
  } else if (creationState?.campaignId) {
    emitMarketingUpdate({
      type: 'log',
      status: 'running',
      line: '[FACEBOOK-UI] La campaña ya existe, asi que ire por el arbol lateral izquierdo para abrir directamente el anuncio sin depender de Siguiente.',
    })
    await sleep(450)
    adUiState = await tryFacebookUiReachAdEditor(preview, { onlyReplaceImage: true })
  } else {
    emitMarketingUpdate({
      type: 'log',
      status: 'warning',
      line: '[FACEBOOK-UI] No pasare al conjunto de anuncios porque la campaña actual no termino de configurarse o no se pudo pulsar Siguiente.',
    })
    await sleep(450)
  }

  const reopenedExistingCampaign = Boolean(creationState?.campaignId)
  const uiIncomplete = reopenedExistingCampaign
    ? (!adUiState.reachedEditor || !adUiState.canFinalize)
    : (
      !campaignEditorState.nextClicked ||
      !adsetUiState.nextClicked ||
      !adUiState.reachedEditor ||
      !adUiState.canFinalize
    )

  return {
    browserOpen,
    campaignEditorState,
    adsetUiState,
    adUiState,
    uiIncomplete,
  }
}

function registerMarketingHandlers(ipcMain) {
  ipcMain.handle('list-facebook-page-photos', async (_event, payload = {}) => {
    try {
      return await listFacebookPagePhotos(payload)
    } catch (err) {
      throw new Error(err.message || 'No se pudieron consultar las fotos de Facebook.')
    }
  })

  ipcMain.handle('run-marketing-campaign-preview', async (_event, payload = {}) => {
    if (state.marketingRunInProgress) {
      return { success: false, error: 'Ya hay una ejecucion del agente de marketing en curso' }
    }

    const campaignIdea = String(payload.campaignIdea || '').trim()
    const companyName = String(payload.companyName || getProjectEnv().PUBLICIDAD_COMPANY_NAME || '').trim()
    const prePrompt = String(payload.prePrompt || '').trim()
    const city = String(payload.city || '').trim()
    const zones = Array.isArray(payload.zones)
      ? payload.zones.map((value) => String(value || '').trim()).filter(Boolean)
      : []
    const contactMode = String(payload.contactMode || '').trim() === 'whatsapp' ? 'whatsapp' : 'lead_form'
    const useZoneIntelligence = Boolean(payload.useZoneIntelligence)
    const useAudienceSegmentation = Boolean(payload.useAudienceSegmentation)
    const generateImageFromMarketingPrompt = Boolean(payload.generateImageFromMarketingPrompt)
    const marketingPrompt = String(payload.marketingPrompt || '').trim()
    const budget = String(payload.budget || '').trim()
    const startDate = String(payload.startDate || '').trim()
    const endDate = String(payload.endDate || '').trim()
    const facebookPhotoUrl = String(payload.facebookPhotoUrl || '').trim()
    const facebookPhotoId = String(payload.facebookPhotoId || '').trim()
    const imageFormat = String(payload.imageFormat || '').trim()

    if ((!campaignIdea && !prePrompt) || !city || !budget || !startDate || !endDate) {
      return { success: false, error: 'Faltan concepto de campana, ciudad, presupuesto o fechas para ejecutar el agente' }
    }

    const contactConfig = getMarketingContactModeConfig(contactMode)
    const resolvedCampaignIdea = campaignIdea || prePrompt
    const company = companyName ? lookupCompanyData(companyName) : null
    const resolvedWebsite = ensureAbsoluteUrl(company?.sitio_web || getProjectEnv().BUSINESS_WEBSITE || 'https://noyecode.com')
    const segmentPreview = buildMarketingSegmentFromPreview({
      campaignIdea: resolvedCampaignIdea,
      prePrompt,
      city,
      zones,
      contactMode,
    })

    state.marketingRunInProgress = true
    emitMarketingUpdate({ type: 'status', status: 'running', summary: 'Ejecutando agente de marketing...' })

    const preview = {
      objective: contactConfig.objectiveLabel,
      url: resolvedWebsite,
      companyName,
      country: segmentPreview.country,
      city,
      zones,
      campaignIdea: resolvedCampaignIdea,
      prePrompt,
      contactMode,
      zoneIntelligenceEnabled: useZoneIntelligence,
      audienceSegmentationEnabled: useAudienceSegmentation,
      generateImageFromMarketingPrompt,
      marketingPrompt,
      formFields: contactConfig.formFields,
      budget,
      startDate,
      endDate,
      mcpAvailable: false,
      leadgenFormsLoaded: false,
      leadgenForms: [],
      selectedLeadgenFormId: '',
      selectedLeadgenFormName: '',
      selectedLeadgenFormReason: '',
      facebookPhotoUrl,
      facebookPhotoId,
      imageAsset: null,
      manualUploadImagePath: '',
      creativeDraftConfig: null,
      adDraftConfig: null,
      metaCreative: null,
      metaAd: null,
      browserMonitorUrl: '',
      zoneInsights: null,
      audienceInsights: null,
      process: [],
      orchestrator: null,
      generatedImagePrompt: '',
      generatedImageStatus: generateImageFromMarketingPrompt ? 'pending' : 'disabled',
      generatedImageError: '',
    }

    try {
      state.marketingMonitorEvents = []
      state.marketingMonitorNextId = 1
      preview.browserMonitorUrl = await openMarketingBrowserMonitor()
      preview.imageAsset = prepareLatestMarketingImageAsset(IMAGE_FORMATS[imageFormat])

      let orchestrator = runLocalMarketingOrchestrator({
        ...preview,
        useZoneIntelligence,
        useAudienceSegmentation,
      })
      preview.orchestrator = orchestrator
      preview.zoneInsights = orchestrator.zoneInsights || null
      preview.audienceInsights = orchestrator.audienceInsights || null

      if (generateImageFromMarketingPrompt) {
        emitMarketingUpdate({
          type: 'log',
          status: 'running',
          line: '[IMAGE-AUTO] Generando imagen automatica desde el prompt final del agente marketing...',
          summary: 'Generando imagen automatica para el anuncio.',
        })
        await sleep(450)

        const generation = await generateMarketingImageAsset({
          preview,
          orchestrator,
          imageFormat: imageFormat || 'fb-horizontal',
          onLog: (line) => emitMarketingUpdate({ type: 'log', status: 'running', line }),
        })

        preview.generatedImagePrompt = generation.prompt || ''
        preview.generatedImageStatus = generation.status || 'failed'
        preview.generatedImageError = generation.error || ''

        if (generation.success && generation.asset) {
          preview.imageAsset = generation.asset
          orchestrator = runLocalMarketingOrchestrator({
            ...preview,
            useZoneIntelligence,
            useAudienceSegmentation,
          })
          preview.orchestrator = orchestrator
          preview.zoneInsights = preview.orchestrator.zoneInsights || null
          preview.audienceInsights = preview.orchestrator.audienceInsights || null

          emitMarketingUpdate({
            type: 'log',
            status: 'running',
            line: `[IMAGE-AUTO] Imagen generada y preparada: ${generation.asset.fileName}. ${generation.asset.adjustmentReason}`,
            summary: 'Imagen automatica lista para el contenido del anuncio.',
          })
          await sleep(450)
        } else {
          emitMarketingUpdate({
            type: 'log',
            status: 'warning',
            line: `[IMAGE-AUTO] No pude generar la imagen automatica. Se continuara con el asset actual. ${generation.error || ''}`.trim(),
            summary: 'La generacion automatica de imagen fallo; continuo con el flujo actual.',
          })
          await sleep(450)
        }
      }

      preview.manualUploadImagePath = exportMarketingAssetToDownloads(preview)
      if (preview.manualUploadImagePath) {
        emitMarketingUpdate({
          type: 'log',
          status: 'running',
          line: `[ASSET] Copie la imagen lista para anuncio a Descargas: ${preview.manualUploadImagePath}`,
          summary: 'Imagen preparada para subir manualmente.',
        })
        await sleep(450)
      }

      emitMarketingUpdate({
        type: 'log',
        status: 'running',
        line: `[BROWSER] Monitor abierto en ${preview.browserMonitorUrl} para seguir el armado paso a paso.`,
        summary: 'Monitor del navegador abierto.',
      })
      await sleep(450)

      const envVars = getProjectEnv()
      const resolvedAdAccount = String(preview.mcpAdAccountId || envVars.FB_AD_ACCOUNT_ID || 'act_438871067037500').trim()
      if (contactMode === 'lead_form') {
        emitMarketingUpdate({
          type: 'log',
          status: 'running',
          line: `[META API] Modo Lead Form. Cuenta: ${resolvedAdAccount}.`,
          summary: 'Preparando campana de leads via Meta API.',
        })
        await sleep(450)
      }

      emitMarketingUpdate({
        type: 'log',
        status: 'running',
        line: preview.imageAsset
          ? `[ASSET] Imagen mas reciente detectada: ${preview.imageAsset.fileName}. ${preview.imageAsset.adjustmentReason}`
          : `[ASSET] No se encontraron imagenes en ${getMarketingImagesDir()}.`,
        summary: 'Preparando asset visual.',
      })
      await sleep(450)

      const preflightSteps = [
        '[1/8] Iniciando agente orquestador...',
        `PLAN: ${orchestrator.plan.task}`,
        `[2/8] Orquestador -> ads-analyst: generando brief para ${orchestrator.execution.campaignType} con cuenta ${orchestrator.execution.accountHint}...`,
        `[3/8] ads-analyst listo: ${orchestrator.adsAnalyst.hook}`,
        `[4/8] seo-analyzer listo: ${orchestrator.seoAnalyzer?.zoneSummary || 'sin analisis adicional'}`,
        `[5/8] Orquestador -> image-creator: preparando direccion visual ${orchestrator.imageCreator.dimensions}...`,
        '[6/8] image-creator listo: prompt creativo preparado para la pieza principal...',
        `[7/8] Orquestador -> marketing: validando copy, CTA y compliance para ${preview.country}...`,
        `[8/8] marketing ${orchestrator.marketing.verdict}.`,
      ]

      for (const line of preflightSteps) {
        emitMarketingUpdate({ type: 'log', line })
        await sleep(650)
      }

      // ── Meta API REST directa via meta_campaign_engine.py v3 ──
      const { findPython } = require('../utils/process')
      const { spawn } = require('child_process')

      const accessToken = String(
        preview.mcpAccessToken ||
        envVars.FB_ACCESS_TOKEN ||
        envVars.FACEBOOK_ACCESS_TOKEN ||
        ''
      ).trim()

      const pythonBin = findPython()
      if (!pythonBin) {
        emitMarketingUpdate({ type: 'done', status: 'error', summary: 'Python no encontrado en PATH', preview })
        return { success: false, error: 'Python no encontrado' }
      }

      if (!accessToken) {
        emitMarketingUpdate({ type: 'done', status: 'error', summary: 'No hay Meta Access Token configurado. Configúralo en .env o en el formulario.', preview })
        return { success: false, error: 'Falta Meta Access Token' }
      }

      const engineInput = {
        name: resolvedCampaignIdea || 'NoyeCode Campaign',
        budget: budget,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        access_token: accessToken,
        ad_account_id: resolvedAdAccount,
        page_id: String(preview.mcpPageId || envVars.FB_PAGE_ID || '115406607722279').trim(),
        website: preview.url || 'https://www.noyecode.com',
      }

      emitMarketingUpdate({
        type: 'log',
        line: '[META API] Enviando campana B2B a Meta Graph API v22.0 (5 audiencias)...',
      })
      await sleep(400)

      const dryRun = !accessToken
      const args = ['-m', 'core.n8n.meta_campaign_engine', '--stdin']
      if (dryRun) args.push('--dry-run')

      const engineResult = await new Promise((resolve) => {
        let stdout = ''
        let stderr = ''
        const childEnv = { ...envVars, PYTHONPATH: PROJECT_ROOT }

        const child = spawn(pythonBin, args, { cwd: PROJECT_ROOT, env: childEnv })
        child.stdin.write(JSON.stringify(engineInput))
        child.stdin.end()

        child.stdout.on('data', (d) => { stdout += d.toString() })
        child.stderr.on('data', (d) => {
          const text = d.toString()
          stderr += text
          for (const line of text.split('\n').filter(Boolean)) {
            emitMarketingUpdate({ type: 'log', line: `[META API] ${line.trim()}` })
          }
        })

        child.on('close', (code) => {
          try {
            const parsed = JSON.parse(stdout)
            resolve({ ok: code === 0, ...parsed })
          } catch {
            resolve({ ok: false, error: stderr || stdout || `Exit code ${code}` })
          }
        })
      })

      if (engineResult.ok || engineResult.results?.ok) {
        const r = engineResult.results || {}
        const adsetCount = (r.adsets || []).filter(a => a.id).length
        const adCount = (r.adsets || []).reduce((sum, a) => sum + (a.ads || []).length, 0)

        emitMarketingUpdate({
          type: 'log',
          line: `[META API] Campana creada: ${r.campaign?.id || 'N/A'}`,
        })
        if (r.lead_form?.id) {
          emitMarketingUpdate({ type: 'log', line: `[META API] Formulario: ${r.lead_form.id}` })
        }
        emitMarketingUpdate({
          type: 'log',
          line: `[META API] ${adsetCount} conjuntos de anuncios + ${adCount} anuncios creados en PAUSED.`,
        })

        emitMarketingUpdate({
          type: 'done',
          status: (r.errors || []).length > 0 ? 'warning' : 'success',
          summary: (r.errors || []).length > 0
            ? `Campana creada con ${r.errors.length} advertencia(s): ${r.errors[0]}`
            : `Campana B2B creada exitosamente via Meta API. ${adsetCount} audiencias, ${adCount} anuncios en PAUSED.`,
          preview: { ...preview, engineResult },
        })
      } else {
        const errorMsg = engineResult.error || engineResult.results?.errors?.[0] || 'Error desconocido'
        emitMarketingUpdate({
          type: 'done',
          status: 'error',
          summary: `Error creando campana via Meta API: ${errorMsg}`,
          preview: { ...preview, engineResult },
        })
      }

      return { success: true }
    } catch (err) {
      emitMarketingUpdate({
        type: 'done',
        status: 'error',
        summary: `La ejecucion del agente fallo: ${err.message || err}`,
        preview,
      })
      return { success: false, error: err.message }
    } finally {
      state.marketingRunInProgress = false
    }
  })

  // ─── Auto Campaign Engine ─────────────────────────────────────────────────
  ipcMain.handle('run-auto-campaign', async (_event, payload = {}) => {
    const { findPython } = require('../utils/process')
    const { spawn } = require('child_process')
    const { PROJECT_ROOT } = require('../config/project-paths')

    const pythonBin = findPython()
    if (!pythonBin) {
      return { success: false, error: 'Python no encontrado' }
    }

    const dryRun = !!payload.dryRun
    const inputJson = JSON.stringify(payload)

    const args = ['-m', 'core.n8n.meta_campaign_engine']
    if (dryRun) args.push('--dry-run')
    args.push('--stdin')

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      const env = { ...getProjectEnv(), PYTHONPATH: PROJECT_ROOT }

      const child = spawn(pythonBin, args, {
        cwd: PROJECT_ROOT,
        env,
      })

      child.stdin.write(inputJson)
      child.stdin.end()

      child.stdout.on('data', (d) => { stdout += d.toString() })
      child.stderr.on('data', (d) => { stderr += d.toString() })

      child.on('close', (code) => {
        try {
          const result = JSON.parse(stdout)
          resolve({ success: code === 0, ...result })
        } catch {
          resolve({
            success: false,
            error: stderr || stdout || `Exit code ${code}`,
            raw_stdout: stdout,
            raw_stderr: stderr,
          })
        }
      })
    })
  })
}

module.exports = { registerMarketingHandlers }
