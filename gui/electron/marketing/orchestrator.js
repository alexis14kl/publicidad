const { ensureAbsoluteUrl, buildPrivacyPolicyUrl, normalizeUiText } = require('../utils/helpers')
const { getProjectEnv } = require('../utils/env')
const {
  getDefaultMarketingSegment,
  getMarketingContactModeConfig,
  buildMarketingSegmentFromPreview,
  buildAudienceSummary,
  buildTargetingSummary,
} = require('./segment')
const {
  facebookApiRequest,
  getMetaPageId,
  getTargetAdAccountId,
  getPrimaryAdAccount,
  getAdAccountByName,
  getAdAccountById,
} = require('../facebook/api')
const {
  resolveCampaignObjectiveRule,
  buildDraftCampaignName,
  buildDraftAdsetName,
  buildDraftLeadFormName,
} = require('../facebook/ui-campaign')

function buildLeadTargeting(orchestrator = null) {
  const segment = orchestrator?.execution?.segment || getDefaultMarketingSegment()
  return {
    geo_locations: {
      countries: [segment.countryCode || 'CO'],
    },
    age_min: segment.ageMin || 24,
    age_max: segment.ageMax || 54,
    targeting_automation: { advantage_audience: 0 },
  }
}

function buildLeadFormSpec(preview, orchestrator) {
  const segment = orchestrator?.execution?.segment || getDefaultMarketingSegment()
  const websiteUrl = ensureAbsoluteUrl(preview?.url || getProjectEnv().BUSINESS_WEBSITE || 'https://noyecode.com')
  const contactConfig = getMarketingContactModeConfig(segment.contactMode)
  const env = getProjectEnv()
  const serviceLabel = String(segment?.serviceLabel || segment?.shortLabel || 'nuestro servicio').trim()
  const intentMode = /b2b|empresa|empresas|operaciones|logistics|software|desarrollo/i.test(
    [segment?.industry, segment?.role, segment?.categoryStatement].filter(Boolean).join(' ')
  )
    ? 'higher_intent'
    : 'higher_volume'
  return {
    page_id: String(orchestrator?.execution?.pageId || getMetaPageId()).trim(),
    page_access_token: String(env.FB_PAGE_ACCESS_TOKEN || env.FACEBOOK_PAGE_ACCESS_TOKEN || '').trim(),
    form_id: String(preview?.selectedLeadgenFormId || '').trim(),
    discover: true,
    create_if_missing: true,
    name: buildDraftLeadFormName(preview, orchestrator),
    locale: 'es_LA',
    required_fields: contactConfig.requiredKeys,
    ui_field_labels: contactConfig.formFields,
    form_type: intentMode,
    follow_up_action_url: websiteUrl,
    privacy_policy_url: buildPrivacyPolicyUrl(websiteUrl),
    privacy_policy_link_text: 'Politica de privacidad',
    intro_headline: `Conoce mas sobre ${serviceLabel}`,
    intro_body: String(segment?.strategicAngle || `Completa tus datos y te contactamos sobre ${serviceLabel}.`).trim(),
    thank_you_title: 'Gracias por tu interes',
    thank_you_body: String(segment?.primaryCta || `Revisaremos tu solicitud sobre ${serviceLabel} y te contactaremos pronto.`).trim(),
    thank_you_button_text: contactConfig.mode === 'whatsapp' ? 'Abrir WhatsApp' : 'Visitar sitio web',
  }
}

function buildOrchestratorPlan(preview, segment = getDefaultMarketingSegment()) {
  const locationSummary = segment.city ? `${segment.city}${segment.zoneLabel ? ` (${segment.zoneLabel})` : ''}` : segment.country
  const contactSummary = segment.contactChannelLabel || 'Formulario instantaneo'
  return {
    task: `Configurar borrador de campana Facebook Ads para "${segment.serviceLabel || segment.shortLabel}" en ${locationSummary}, orientada a ${contactSummary}, con presupuesto maximo ${preview.budget} entre ${preview.startDate} y ${preview.endDate}.`,
    agent: 'orchestrator',
    reason: 'Coordina ads-analyst, image-creator y marketing antes de enviar la configuracion a Meta Ads.',
    cost: 'medio',
    approvedByUser: true,
  }
}

function buildMarketingAgentPrompt(preview, segment = getDefaultMarketingSegment(), selectedImage = null) {
  const promptOverride = String(preview?.marketingPrompt || '').trim()
  if (promptOverride) {
    return promptOverride
  }

  const websiteUrl = ensureAbsoluteUrl(preview?.url || getProjectEnv().BUSINESS_WEBSITE || 'https://noyecode.com')
  const contactConfig = getMarketingContactModeConfig(segment.contactMode)
  const imageStatus = selectedImage?.preparedPath
    ? `Asset listo: ${selectedImage.fileName} (${selectedImage.width || 0}x${selectedImage.height || 0}) en ${selectedImage.preparedPath}.`
    : 'No hay asset final confirmado; el agente debe trabajar con recomendacion de formato y briefing visual.'

  return [
    '# Prompt: Bot Asistente para Crear Campanas de Facebook Ads',
    '',
    '## Instruccion para el Bot',
    'Eres un experto en Facebook Ads y Meta Business Suite. Tu rol es guiar paso a paso al usuario para crear una campana de publicidad en Facebook Ads, desde la estrategia hasta la publicacion. Siempre preguntas antes de asumir y adaptas las recomendaciones al presupuesto, industria y objetivo del usuario.',
    '',
    '## Reglas Operativas Obligatorias',
    '1. Siempre pregunta antes de asumir y deja explicitas las variables faltantes.',
    '2. Justifica el objetivo de campana segun la meta del negocio.',
    '3. Para presupuestos menores a 50 USD/dia, recomienda audiencias entre 100K y 1M.',
    '4. Para campanas nuevas, inicia con presupuesto diario y menor costo durante 3-5 dias.',
    '5. Para leads B2B con formulario instantaneo, recomienda formularios de mayor intencion.',
    '6. Genera 2-3 variantes de copy y propone formato visual segun objetivo.',
    '7. Incluye checklist de revision pre-publicacion y pautas de optimizacion dia 3-5 y dia 7+.',
    '',
    '## Objetivos Disponibles en Meta Ads Manager',
    '- Reconocimiento: para awareness de marca.',
    '- Trafico: para enviar usuarios a sitio web o app.',
    '- Interaccion: para likes, comentarios, mensajes y compartidos.',
    '- Clientes potenciales: para capturar datos con formulario dentro de Facebook.',
    '- Promocion de app: para descargas.',
    '- Ventas: para compras en sitio web con Pixel configurado.',
    '',
    '## Contexto Actual de la Campana',
    `- Concepto de campana: ${segment.serviceLabel || preview.campaignIdea || segment.shortLabel}.`,
    `- Objetivo de negocio recomendado: ${contactConfig.objectiveLabel}.`,
    `- Producto/servicio: ${segment.categoryStatement}.`,
    `- Publico base: ${segment.role} del sector ${segment.industry} en ${segment.country}, ciudad ${segment.city || segment.country}, zonas ${segment.zoneLabel || 'toda la ciudad'}.`,
    `- Dolor principal: ${segment.pain}.`,
    `- Consecuencia: ${segment.consequence}.`,
    `- Trigger: ${segment.trigger}.`,
    `- Presupuesto maximo actual: ${preview.budget}.`,
    `- Duracion actual: ${preview.startDate} -> ${preview.endDate}.`,
    `- Activos disponibles: landing ${websiteUrl}, canal de contacto ${contactConfig.channelLabel}${contactConfig.formFields.length > 0 ? ` con ${contactConfig.formFields.join(', ')}` : ''}, ${imageStatus}`,
    `- Experiencia previa del usuario: no confirmada; explicar con lenguaje claro pero profesional.`,
    '',
    '## Configuracion Recomendada para este Caso',
    `- Objetivo de campana: ${contactConfig.objectiveLabel}.`,
    `- Tipo de contacto: ${contactConfig.channelLabel}.`,
    '- Ubicaciones minimas: Facebook Feed, Instagram Feed y Stories.',
    '- Estrategia de puja: Menor costo.',
    '- Formato creativo recomendado: Imagen unica para pruebas rapidas de lead ads.',
    `- CTA sugerido: ${contactConfig.copyCta}.`,
    '',
    '## Copy Framework',
    '- Texto principal: hook + valor + prueba social si existe + CTA.',
    '- Titulo: beneficio directo en maximo 40 caracteres.',
    '- Descripcion: complemento breve en maximo 30 caracteres.',
    '- Generar 2-3 variantes para testing.',
    '',
    '## Contexto Noyecode',
    '- Empresa: Monjekey Jobs S.A.S (marca Noyecode).',
    '- Web: https://www.noyecode.com/',
    '- WhatsApp: +57 301 385 9952.',
    '- Email: gerson@noyecode.com.',
    '- Mercado: Colombia B2B, empresas 20-120 empleados.',
    '- Pagina Facebook: Noyecode (ID 115406607722279).',
  ].join('\n')
}

function runLocalMarketingOrchestrator(preview) {
  const segment = buildMarketingSegmentFromPreview(preview)
  const contactConfig = getMarketingContactModeConfig(preview?.contactMode)
  const plan = buildOrchestratorPlan(preview, segment)
  const pageId = getMetaPageId()
  const selectedImage = preview?.imageAsset || null
  const marketingAgentPrompt = buildMarketingAgentPrompt(preview, segment, selectedImage)
  const campaignName = buildDraftCampaignName(preview, { execution: { segment } })
  const adsetName = buildDraftAdsetName(preview, { execution: { segment } })
  const leadFormName = buildDraftLeadFormName(preview, { execution: { segment } })
  const leadFormFieldLabels = contactConfig.formFields
  const leadFormRequiredKeys = contactConfig.requiredKeys
  const adsAnalyst = {
    platform: 'Facebook Ads',
    format: contactConfig.mode === 'whatsapp' ? 'Imagen unica para mensajes de WhatsApp' : 'Imagen unica para Lead Ads',
    objective: contactConfig.objectiveLabel,
    audience: buildAudienceSummary(segment),
    hook: segment.hook,
    copy:
      contactConfig.mode === 'whatsapp'
        ? `Si estas buscando ${segment.serviceLabel.toLowerCase()} en ${segment.city}, esta campana prioriza ${segment.zoneLabel}. ${segment.strategicAngle} ${segment.primaryCta}`
        : `Si necesitas ${segment.serviceLabel.toLowerCase()} en ${segment.city}, esta campana prioriza ${segment.zoneLabel}. ${segment.strategicAngle} ${segment.primaryCta}`,
    cta: contactConfig.copyCta,
    visualReference: segment.visualReference,
    city: segment.city,
    zones: segment.zones,
    service: segment.serviceLabel,
    industry: segment.industry,
    role: segment.role,
    pain: segment.pain,
    consequence: segment.consequence,
    trigger: segment.trigger,
    strategicAngle: segment.strategicAngle,
    assumptions: [
      `Se tomo como base el concepto "${segment.serviceLabel}" con foco geografico en ${segment.city} y zonas ${segment.zoneLabel}.`,
      `El canal de contacto solicitado fue ${contactConfig.channelLabel}.`,
      'La promesa se mantiene concreta y sin metricas inventadas.',
    ],
  }

  const imageCreator = {
    dimensions: '1200x628',
    style: contactConfig.mode === 'whatsapp' ? 'Local service cercano y confiable' : 'Captacion local premium',
    prompt:
      `Create a Facebook ad image for ${segment.serviceLabel} in ${segment.city}, Colombia. Prioritize visual cues from ${segment.zoneLabel}. Show ${segment.visualReference}. Keep it clean, high-contrast, mobile-friendly, no tiny unreadable text, and aligned with a ${contactConfig.mode === 'whatsapp' ? 'WhatsApp conversation' : 'lead generation'} campaign.`,
    status: selectedImage?.preparedPath ? 'asset_local_listo' : 'brief_listo',
    selectedAsset: selectedImage
      ? {
        sourcePath: selectedImage.sourcePath,
        preparedPath: selectedImage.preparedPath,
        adjusted: selectedImage.adjusted,
        adjustmentReason: selectedImage.adjustmentReason,
      }
      : null,
  }

  const marketing = {
    status: 'approved_with_assumptions',
    verdict: 'APROBADO para borrador',
    prompt: marketingAgentPrompt,
    notes: [
      'Se aplico el prompt operativo de Facebook Ads para definir objetivo, audiencia, presupuesto, creatividad y checklist.',
      `CTA de baja friccion alineado con ${contactConfig.channelLabel}.`,
      `Narrativa centrada en ${segment.pain.toLowerCase()}`,
      contactConfig.mode === 'lead_form'
        ? 'Pendiente activo visual final y leadgen_form_id para completar creative y anuncio.'
        : 'Modo WhatsApp: el flujo actual deja brief, copy y prompt visual listos; la automatizacion completa del anuncio se conecta despues.',
    ],
    compliance: {
      specialAdCategories: [],
      categoryStatement: segment.categoryStatement,
    },
  }
  const objectiveRule = resolveCampaignObjectiveRule(preview, {
    execution: { campaignType: contactConfig.campaignType, segment },
    adsAnalyst,
  })

  return {
    plan,
    adsAnalyst,
    imageCreator,
    marketing,
    execution: {
      accountHint: `act_${getTargetAdAccountId()}`,
      accountId: getTargetAdAccountId(),
      pageId,
      campaignType: contactConfig.campaignType,
      campaignName,
      adsetName,
      leadFormName,
      budgetCap: preview.budget,
      formFields: contactConfig.formFields,
      segment,
      city: segment.city,
      zones: segment.zones,
      contactChannel: contactConfig.channelLabel,
      targetingSummary: buildTargetingSummary(segment),
      objectiveUiLabel: objectiveRule.uiLabel,
      apiObjective: objectiveRule.apiObjective,
      budgetModeUiLabel: 'Presupuesto de la campa\u00f1a',
      budgetModeUiAliases: ['Presupuesto de la campa\u00f1a', 'Campaign budget', 'Presupuesto total', 'Lifetime budget'],
      budgetAmountModeUiLabel: 'Presupuesto diario',
      budgetAmountModeUiAliases: ['Presupuesto diario', 'Daily budget'],
      conversionLocationUiLabel: contactConfig.mode === 'whatsapp' ? 'WhatsApp' : 'Sitio web y formularios instant\u00e1neos',
      conversionLocationUiAliases: contactConfig.mode === 'whatsapp'
        ? ['WhatsApp', 'Whatsapp', 'Messages']
        : ['Sitio web y formularios instant\u00e1neos', 'Sitio web y formularios instantaneos', 'Website and instant forms', 'Formularios instant\u00e1neos', 'Instant forms', 'Instant form'],
      performanceGoalUiLabel: contactConfig.mode === 'whatsapp'
        ? 'Maximizar conversaciones'
        : 'Maximizar el n\u00famero de clientes potenciales',
      leadFormFieldLabels,
      leadFormRequiredKeys,
    },
  }
}

function toMetaMoney(value) {
  const numeric = Number(String(value || '').replace(',', '.'))
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('El presupuesto ingresado no es valido para Meta Ads.')
  }
  return String(Math.round(numeric))
}

function toMetaDateTime(dateValue, endOfDay = false) {
  const suffix = endOfDay ? 'T23:59:00-0500' : 'T00:00:00-0500'
  return `${dateValue}${suffix}`
}

async function createDraftCampaign(preview, token, accountHint = '') {
  const normalizedHint = String(accountHint || '').trim()
  const account = normalizedHint
    ? /^act?_?\d+$/.test(normalizedHint.replace(/^act_/, 'act'))
      ? await getAdAccountById(token, normalizedHint)
      : await getAdAccountByName(token, normalizedHint)
    : await getPrimaryAdAccount(token)
  const campaignName = buildDraftCampaignName(preview)
  const accountNode = String(account.id || '').trim()
  if (!accountNode) {
    throw new Error('Meta no devolvio el identificador de la cuenta publicitaria.')
  }

  let created
  try {
    created = await facebookApiRequest(
      'POST',
      `${accountNode}/campaigns`,
      {
        name: campaignName,
        objective: 'OUTCOME_LEADS',
        status: 'PAUSED',
        is_adset_budget_sharing_enabled: false,
        special_ad_categories: [],
      },
      token
    )
  } catch (error) {
    throw new Error(
      `Fallo creando campaign en ${accountNode} | objective=OUTCOME_LEADS | status=PAUSED | is_adset_budget_sharing_enabled=false | ${error.message || error}`
    )
  }

  return {
    account,
    campaignId: created?.id || '',
    campaignName,
  }
}

async function createDraftAdSet(preview, token, creation) {
  const accountNode = String(creation?.account?.id || '').trim()
  const campaignId = String(creation?.campaignId || '').trim()
  if (!accountNode || !campaignId) {
    throw new Error('No tengo datos suficientes para crear el conjunto de anuncios.')
  }

  const adsetName = `Ad Set Borrador | Leads CO | ${preview.startDate} -> ${preview.endDate}`
  let created
  try {
    created = await facebookApiRequest(
      'POST',
      `${accountNode}/adsets`,
      {
        name: adsetName,
        campaign_id: campaignId,
        daily_budget: toMetaMoney(preview.budget),
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LEAD_GENERATION',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        destination_type: 'ON_AD',
        status: 'PAUSED',
        start_time: toMetaDateTime(preview.startDate, false),
        end_time: toMetaDateTime(preview.endDate, true),
        promoted_object: {
          page_id: getMetaPageId(),
        },
        targeting: {
          geo_locations: {
            countries: ['CO'],
          },
          age_min: 18,
          age_max: 65,
        },
      },
      token
    )
  } catch (error) {
    throw new Error(
      `Fallo creando adset en ${accountNode} | campaign_id=${campaignId} | budget=${preview.budget} | page_id=${getMetaPageId()} | ${error.message || error}`
    )
  }

  return {
    adsetId: created?.id || '',
    adsetName,
    targetingSummary: 'Colombia, 18-65, segmentacion amplia',
  }
}

module.exports = {
  buildLeadTargeting,
  buildLeadFormSpec,
  buildOrchestratorPlan,
  buildMarketingAgentPrompt,
  runLocalMarketingOrchestrator,
  toMetaMoney,
  toMetaDateTime,
  createDraftCampaign,
  createDraftAdSet,
}
