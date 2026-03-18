const { getProjectEnv } = require('../utils/env')
const { ensureAbsoluteUrl, sleep } = require('../utils/helpers')
const state = require('../state')
const { getMarketingContactModeConfig, buildMarketingSegmentFromPreview } = require('../marketing/segment')
const { runLocalMarketingOrchestrator } = require('../marketing/orchestrator')
const { getMarketingImagesDir, prepareLatestMarketingImageAsset } = require('../marketing/image-asset')
const { IMAGE_FORMATS } = require('../config/image-formats')
const { openMarketingBrowserMonitor } = require('../marketing/monitor')
const { ensureFacebookVisualBrowser } = require('../facebook/visual-browser')
const { getMetaPageId, getTargetAdAccountId, getFacebookAdsCdpInfo } = require('../facebook/api')
const { listFacebookPagePhotos } = require('../facebook/api')
const { tryFacebookUiCreateCampaign, tryFacebookUiConfigureCampaignEditor } = require('../facebook/ui-campaign')
const { tryFacebookUiConfigureAdsetSchedule } = require('../facebook/ui-adset')
const { tryFacebookUiReachAdEditor } = require('../facebook/ui-ad-editor')
const {
  emitMarketingUpdate,
  openMetaAdsManager,
  buildCampaignProcess,
  runLeadCampaignBundleViaCdp,
  runLeadCampaignBundleViaN8n,
} = require('../marketing/campaign-process')
const { applyMcpBundleResultToPreview } = require('../marketing/campaign-bundle')

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
    const city = String(payload.city || '').trim()
    const zones = Array.isArray(payload.zones)
      ? payload.zones.map((value) => String(value || '').trim()).filter(Boolean)
      : []
    const contactMode = String(payload.contactMode || '').trim() === 'whatsapp' ? 'whatsapp' : 'lead_form'
    const marketingPrompt = String(payload.marketingPrompt || '').trim()
    const budget = String(payload.budget || '').trim()
    const startDate = String(payload.startDate || '').trim()
    const endDate = String(payload.endDate || '').trim()
    const facebookPhotoUrl = String(payload.facebookPhotoUrl || '').trim()
    const facebookPhotoId = String(payload.facebookPhotoId || '').trim()
    const imageFormat = String(payload.imageFormat || '').trim()

    if (!campaignIdea || !city || !budget || !startDate || !endDate) {
      return { success: false, error: 'Faltan concepto de campana, ciudad, presupuesto o fechas para ejecutar el agente' }
    }

    const contactConfig = getMarketingContactModeConfig(contactMode)
    const segmentPreview = buildMarketingSegmentFromPreview({ campaignIdea, city, zones, contactMode })

    state.marketingRunInProgress = true
    emitMarketingUpdate({ type: 'status', status: 'running', summary: 'Ejecutando agente de marketing...' })

    const preview = {
      objective: contactConfig.objectiveLabel,
      url: ensureAbsoluteUrl(getProjectEnv().BUSINESS_WEBSITE || 'https://noyecode.com'),
      country: segmentPreview.country,
      city,
      zones,
      campaignIdea,
      contactMode,
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
      creativeDraftConfig: null,
      adDraftConfig: null,
      metaCreative: null,
      metaAd: null,
      browserMonitorUrl: '',
      process: [],
      orchestrator: null,
    }

    try {
      state.marketingMonitorEvents = []
      state.marketingMonitorNextId = 1
      preview.browserMonitorUrl = await openMarketingBrowserMonitor()
      preview.imageAsset = prepareLatestMarketingImageAsset(IMAGE_FORMATS[imageFormat])
      const targetActId = getTargetAdAccountId()
      if (contactMode === 'lead_form') {
        await ensureFacebookVisualBrowser(targetActId)
      }

      const orchestrator = runLocalMarketingOrchestrator(preview)
      preview.orchestrator = orchestrator

      emitMarketingUpdate({
        type: 'log',
        status: 'running',
        line: `[BROWSER] Monitor abierto en ${preview.browserMonitorUrl} para seguir el armado paso a paso.`,
        summary: 'Monitor del navegador abierto.',
      })
      await sleep(450)

      if (contactMode === 'lead_form') {
        emitMarketingUpdate({
          type: 'log',
          status: 'running',
          line: `[FACEBOOK] Navegador visual abierto en Ads Manager para la cuenta act_${targetActId}. Si Facebook pide login, inicia sesion ahi y el overlay seguira mostrando el paso a paso.`,
          summary: 'Facebook Ads Manager abierto en navegador normal.',
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
        '[1/7] Iniciando agente orquestador...',
        `PLAN: ${orchestrator.plan.task}`,
        `[2/7] Orquestador -> ads-analyst: generando brief para ${orchestrator.execution.campaignType} con cuenta ${orchestrator.execution.accountHint}...`,
        `[3/7] ads-analyst listo: ${orchestrator.adsAnalyst.hook}`,
        `[4/7] Orquestador -> image-creator: preparando direccion visual ${orchestrator.imageCreator.dimensions}...`,
        '[5/7] image-creator listo: prompt creativo preparado para la pieza principal...',
        `[6/7] Orquestador -> marketing: validando copy, CTA y compliance para ${preview.country}...`,
        `[7/7] marketing ${orchestrator.marketing.verdict}.`,
      ]

      for (const line of preflightSteps) {
        emitMarketingUpdate({ type: 'log', line })
        await sleep(650)
      }

      // ── CDP campaign creation (supports lead_form + whatsapp) ──
      const cdpInfo = getFacebookAdsCdpInfo()
      const cdpIssues = []
      if (!cdpInfo.serverExists) {
        cdpIssues.push('No existe el servidor CDP fb_ads_cdp_server.py')
      }
      if (!cdpInfo.helperExists) {
        cdpIssues.push('No existe el runner CDP fb_ads_cdp_run.py')
      }
      if (!cdpInfo.pythonBin) {
        cdpIssues.push('Python no disponible en PATH')
      }
      if (!cdpInfo.token) {
        cdpIssues.push('No hay token de Facebook en .env (se intentara extraer via CDP)')
      }
      const cdpReady = Boolean(cdpInfo.serverExists && cdpInfo.helperExists && cdpInfo.pythonBin && (cdpInfo.token || cdpInfo.cdpPort))

      preview.mcpAvailable = cdpReady
      preview.process = buildCampaignProcess({ ready: cdpReady, issues: cdpReady ? [] : cdpIssues }, preview, null, orchestrator)

      const modeLabel = contactMode === 'whatsapp' ? 'WhatsApp' : 'Lead Form'
      emitMarketingUpdate({
        type: 'log',
        line: cdpReady
          ? `[CDP] Servidor CDP listo. Token: ${cdpInfo.token ? 'si' : 'se extraera del navegador'}. Puerto CDP: ${cdpInfo.cdpPort}. Modo: ${modeLabel}`
          : `[CDP] El servidor CDP no esta listo: ${cdpIssues.join(', ')}`,
      })
      await sleep(650)

      emitMarketingUpdate({
        type: 'log',
        line: `[CDP] El brief del orquestador esta listo. Enviando payload al servidor CDP (${modeLabel})...`,
      })
      await sleep(450)

      if (cdpReady) {
        emitMarketingUpdate({
          type: 'log',
          line: `[CDP] Creando campana via CDP para ${orchestrator.execution.accountHint}...`,
        })
        await sleep(650)

        let creationState = null
        let bundleError = null
        try {
          const bundleResult = await runLeadCampaignBundleViaCdp(preview, orchestrator)
          creationState = applyMcpBundleResultToPreview(preview, orchestrator, bundleResult)
          preview.process = buildCampaignProcess({ ready: true, issues: [] }, preview, creationState, orchestrator)

          emitMarketingUpdate({
            type: 'log',
            line: preview.leadgenForms.length > 0
              ? `[CDP] Consulto ${preview.leadgenForms.length} formulario(s) Instant Form y selecciono ${preview.selectedLeadgenFormName || 'ninguno'} ${preview.selectedLeadgenFormId ? `(${preview.selectedLeadgenFormId})` : ''}.`
              : bundleResult?.leadgen_forms_error
                ? `[CDP] No pudo consultar formularios Instant Form: ${bundleResult.leadgen_forms_error}`
                : `[CDP] No encontro formularios Instant Form utilizables para la pagina ${orchestrator.execution.pageId}.`
          })
          await sleep(650)

          if (creationState.campaignId) {
            emitMarketingUpdate({
              type: 'log',
              line: `[CDP] Campaign creada. ID ${creationState.campaignId} en cuenta ${creationState.account?.name || creationState.account?.id}.`,
            })
            await sleep(650)
          }

          if (creationState.adsetId) {
            emitMarketingUpdate({
              type: 'log',
              line: `[CDP] Ad set creado. ID ${creationState.adsetId}. Publico: ${creationState.targetingSummary}.`,
            })
            await sleep(650)
          } else if (creationState.adsetDeferredToUi) {
            emitMarketingUpdate({
              type: 'log',
              status: 'running',
              line: '[CDP] El ad set se terminara por la UI de Ads Manager porque Meta requiere seleccionar manualmente un objeto promocionado valido.',
            })
            await sleep(650)
          } else if (creationState.adsetError) {
            emitMarketingUpdate({
              type: 'log',
              status: 'warning',
              line: `[CDP] No pudo crear el ad set: ${creationState.adsetError}`,
            })
            await sleep(650)
          }

          if (preview.metaCreative?.creativeId) {
            emitMarketingUpdate({
              type: 'log',
              line: `[CDP] Creative creado. ID ${preview.metaCreative.creativeId}. image_hash ${preview.metaCreative.imageHash}.`,
            })
            await sleep(650)
          }

          if (preview.metaAd?.adId) {
            emitMarketingUpdate({
              type: 'log',
              line: `[CDP] Anuncio creado. ID ${preview.metaAd.adId} en estado PAUSED.`,
            })
            await sleep(650)
          }
        } catch (error) {
          bundleError = error
          emitMarketingUpdate({
            type: 'log',
            status: 'warning',
            line: `[CDP] Error creando campana via CDP: ${error.message || error}`,
          })
          await sleep(650)
        }

        const browserOpen = await openMetaAdsManager(creationState)
        emitMarketingUpdate({
          type: 'log',
          line: browserOpen.ok
            ? `[OPEN] Navegador abierto en ${browserOpen.url} para visualizar Meta Ads Manager.`
            : `[OPEN] No se pudo abrir el navegador automaticamente: ${browserOpen.reason}`,
        })
        await sleep(650)

        if (browserOpen.ok) {
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
          if (creationState?.campaignId) {
            emitMarketingUpdate({
              type: 'log',
              status: 'running',
              line: `[FACEBOOK-UI] La campaña ya fue creada por n8n (${creationState.campaignId}). El flujo visual continuara sobre el editor existente para completar campos pendientes.`,
            })
            await sleep(450)
            campaignEditorState = await tryFacebookUiConfigureCampaignEditor(preview)
          } else {
            const createdFromUi = await tryFacebookUiCreateCampaign(preview)
            if (!createdFromUi) {
              emitMarketingUpdate({
                type: 'log',
                status: 'warning',
                line: '[FACEBOOK-UI] No pude iniciar la creación desde el listado de campañas. Intentare completar lo visible del editor actual.',
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
          } else {
            emitMarketingUpdate({
              type: 'log',
              status: 'warning',
              line: '[FACEBOOK-UI] No pasare al conjunto de anuncios porque la campaña actual no termino de configurarse o no se pudo pulsar Siguiente.',
            })
            await sleep(450)
          }

          const uiIncomplete =
            browserOpen.ok &&
            (
              !campaignEditorState.nextClicked ||
              !adsetUiState.nextClicked ||
              !adUiState.reachedEditor ||
              !adUiState.canFinalize
            )

          emitMarketingUpdate({
            type: 'done',
            status: bundleError || (creationState?.adsetError && !creationState?.adsetDeferredToUi) || uiIncomplete ? 'warning' : 'success',
            summary: bundleError
              ? `Error al crear campana via n8n: ${bundleError.message || bundleError}`
              : uiIncomplete
                ? 'La campaña y el flujo visual siguen en progreso: la automatizacion debe completar campana, conjunto de anuncios y todos los campos visibles del anuncio antes de finalizar.'
              : browserOpen.ok
                ? 'Campana creada via n8n y la UI completo los campos visibles hasta Nuevo anuncio de clientes potenciales.'
              : creationState?.adsetError
                ? `Campana creada via n8n, pero no se pudo crear el ad set: ${creationState.adsetError}`
              : 'Campana creada exitosamente via n8n, pero no se pudo abrir el navegador automaticamente.',
            preview,
          })
        } else {
          emitMarketingUpdate({
            type: 'done',
            status: bundleError || (creationState?.adsetError && !creationState?.adsetDeferredToUi) ? 'warning' : 'success',
            summary: bundleError
              ? `Error al crear campana via n8n: ${bundleError.message || bundleError}`
              : creationState?.adsetDeferredToUi
                ? 'Campana creada via n8n. El conjunto de anuncios quedo delegado a Ads Manager para seleccionar el objeto promocionado.'
              : creationState?.adsetError
                ? `Campana creada via n8n, pero no se pudo crear el ad set: ${creationState.adsetError}`
                : 'Campana creada exitosamente via n8n, pero no se pudo abrir el navegador automaticamente.',
            preview,
          })
        }
      } else {
        const env = getProjectEnv()
        const webhookUrl = String(
          env.N8N_WEBHOOK_CREAR_CAMPANA_FB ||
          env.N8N_WEBHOOK_CREATE_CAMPAIGN_FACEBOOK ||
          '',
        ).trim()

        if (!webhookUrl) {
          emitMarketingUpdate({
            type: 'done',
            status: 'warning',
            summary: 'No se puede crear la campana: falta configurar N8N_WEBHOOK_CREAR_CAMPANA_FB en .env',
            preview,
          })
        } else {
          emitMarketingUpdate({
            type: 'log',
            status: 'running',
            line: `[n8n] Webhook de campanas configurado: ${webhookUrl} (modo: ${modeLabel})`,
          })
          await sleep(450)

          emitMarketingUpdate({
            type: 'log',
            status: 'running',
            line: `[n8n] El brief del orquestador esta listo. Enviando payload al workflow de n8n (${modeLabel})...`,
          })
          await sleep(450)

          let creationState = null
          let bundleError = null

          try {
            emitMarketingUpdate({
              type: 'log',
              status: 'running',
              line: `[n8n] Enviando campana a n8n para ${orchestrator.execution.accountHint}...`,
            })
            await sleep(650)

            const bundleResult = await runLeadCampaignBundleViaN8n(preview, orchestrator)
            creationState = applyMcpBundleResultToPreview(preview, orchestrator, bundleResult)
            preview.process = buildCampaignProcess({ ready: true, issues: [] }, preview, creationState, orchestrator)
          } catch (error) {
            bundleError = error
            emitMarketingUpdate({
              type: 'log',
              status: 'warning',
              line: `[n8n] Error creando campana via n8n: ${error.message || error}`,
            })
            await sleep(650)
          }

          const browserOpen = await openMetaAdsManager(creationState)
          emitMarketingUpdate({
            type: 'log',
            line: browserOpen.ok
              ? `[OPEN] Navegador abierto en ${browserOpen.url} para visualizar Meta Ads Manager.`
              : `[OPEN] No se pudo abrir el navegador automaticamente: ${browserOpen.reason}`,
          })
          await sleep(650)

          emitMarketingUpdate({
            type: 'done',
            status: bundleError || (creationState?.adsetError && !creationState?.adsetDeferredToUi) ? 'warning' : 'success',
            summary: bundleError
              ? `Error al crear campana via n8n: ${bundleError.message || bundleError}`
              : creationState?.adsetDeferredToUi
                ? 'Campana creada via n8n. El conjunto de anuncios quedo delegado a Ads Manager para seleccionar el objeto promocionado.'
                : creationState?.adsetError
                  ? `Campana creada via n8n, pero no se pudo crear el ad set: ${creationState.adsetError}`
                  : browserOpen.ok
                    ? 'Campana creada exitosamente via n8n. Se abrio Ads Manager para verificar.'
                    : 'Campana creada exitosamente via n8n, pero no se pudo abrir el navegador automaticamente.',
            preview,
          })
        }
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
}

module.exports = { registerMarketingHandlers }
