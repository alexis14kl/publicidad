const { ensureAbsoluteUrl, buildPrivacyPolicyUrl, normalizeUiText } = require('../utils/helpers')
const { getProjectEnv } = require('../utils/env')
const {
  getDefaultMarketingSegment,
  getMarketingContactModeConfig,
  buildMarketingSegmentFromPreview,
  buildAudienceSummary,
  buildTargetingSummary,
} = require('./segment')
const { buildMarketingIntelligence } = require('./intelligence')
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

function buildMarketingAgentPrompt(preview, segment = getDefaultMarketingSegment(), selectedImage = null, intelligence = null) {
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
    '8. Escribe como un estratega de marketing senior en espanol: claro, persuasivo y orientado a conversion.',
    '9. Evita repetir palabras clave o el nombre del servicio de forma mecanica.',
    '10. Cada copy debe dejar claro que se vende, para quien es, por que importa ahora y cual es la siguiente accion.',
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
    `- Pre-prompt original del usuario: ${String(preview?.prePrompt || preview?.campaignIdea || '').trim() || 'No informado'}.`,
    `- Publico base: ${segment.role} del sector ${segment.industry} en ${segment.country}, ciudad ${segment.city || segment.country}, zonas ${segment.zoneLabel || 'toda la ciudad'}.`,
    `- Dolor principal: ${segment.pain}.`,
    `- Consecuencia: ${segment.consequence}.`,
    `- Trigger: ${segment.trigger}.`,
    preview?.useZoneIntelligence && intelligence?.zoneInsights
      ? `- Zonas con mayor afinidad detectadas por ads-analyst + seo-analyzer: ${intelligence.zoneInsights.topZones.map((item) => item.zone).join(', ')}.`
      : '- Zonas con mayor afinidad detectadas por ads-analyst + seo-analyzer: no activado.',
    preview?.useAudienceSegmentation && intelligence?.audienceInsights
      ? `- Segmentos sugeridos por ads-analyst + seo-analyzer: ${intelligence.audienceInsights.segments.map((item) => item.label).join(' | ')}.`
      : '- Segmentos sugeridos por ads-analyst + seo-analyzer: no activado.',
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
    '- Texto principal: problema real + promesa concreta + diferenciador + CTA.',
    '- Titulo: beneficio directo y entendible en maximo 40 caracteres.',
    '- Descripcion: refuerzo breve, especifico y sin relleno en maximo 30 caracteres.',
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

function buildExpertStrategicAngle(segment = getDefaultMarketingSegment()) {
  if (/software|automatizacion/i.test(segment.industry || '')) {
    return 'Menos reproceso, mas control y una operacion lista para crecer.'
  }
  if (/automotriz/i.test(segment.industry || '')) {
    return 'Opciones claras, atencion agil y una cotizacion mas simple.'
  }
  if (/belleza/i.test(segment.industry || '')) {
    return 'Resultados visibles, confianza y una reserva sin friccion.'
  }
  return segment.strategicAngle
}

function buildExpertHook(segment = getDefaultMarketingSegment(), contactConfig = getMarketingContactModeConfig()) {
  if (/software|automatizacion/i.test(segment.industry || '')) {
    return 'Automatiza tu empresa con mas control'
  }
  if (/automotriz/i.test(segment.industry || '')) {
    return 'Encuentra tu proximo carro hoy'
  }
  if (/belleza/i.test(segment.industry || '')) {
    return 'Reserva tu cambio de imagen hoy'
  }
  return `${segment.hook}${contactConfig.mode === 'whatsapp' ? ' Con una accion simple para iniciar conversacion.' : ' Con una accion simple para captar interesados.'}`
}

function buildExpertPrimaryCopy(segment = getDefaultMarketingSegment(), contactConfig = getMarketingContactModeConfig()) {
  const service = String(segment.serviceLabel || segment.shortLabel || 'tu servicio').trim().toLowerCase()
  const cityLabel = segment.city ? `en ${segment.city}` : 'en tu ciudad'
  const zoneSentence = segment.zoneLabel && segment.zoneLabel !== 'toda la ciudad'
    ? ` Priorizamos ${segment.zoneLabel} para concentrar la campana en zonas con mayor afinidad comercial.`
    : ''
  const closeSentence = contactConfig.mode === 'whatsapp'
    ? ` Escribenos por WhatsApp y te orientamos con una opcion clara y rapida.`
    : ' Dejanos tus datos y te compartimos una propuesta clara para avanzar.'

  if (/automotriz/i.test(segment.industry || '')) {
    return [
      `Si estas comparando ${service} ${cityLabel}, esta campana pone la oferta frente a compradores con intencion real.`,
      'La comunicacion se centra en confianza, claridad comercial y una siguiente accion simple para cotizar sin perder tiempo entre opciones poco claras.',
      `${zoneSentence}${closeSentence}`,
    ].join(' ').replace(/\s{2,}/g, ' ').trim()
  }

  if (/software|automatizacion/i.test(segment.industry || '')) {
    return [
      `Si tu empresa esta evaluando ${service} ${cityLabel}, esta campana conecta la necesidad con una solucion concreta y facil de entender.`,
      'La propuesta habla de orden, eficiencia y crecimiento, no de promesas vacias ni tecnicismos innecesarios.',
      `${zoneSentence}${closeSentence}`,
    ].join(' ').replace(/\s{2,}/g, ' ').trim()
  }

  if (/belleza/i.test(segment.industry || '')) {
    return [
      `Si estas buscando ${service} ${cityLabel}, esta campana muestra una propuesta atractiva, clara y facil de reservar.`,
      'La comunicacion se apoya en confianza, resultado visible y una experiencia que invita a agendar sin seguir comparando.',
      `${zoneSentence}${closeSentence}`,
    ].join(' ').replace(/\s{2,}/g, ' ').trim()
  }

  return [
    `Si estas buscando ${service} ${cityLabel}, esta campana aparece con una propuesta clara y orientada a conversion.`,
    `${segment.strategicAngle} La comunicacion evita rodeos y pone el beneficio principal al frente.`,
    `${zoneSentence}${closeSentence}`,
  ].join(' ').replace(/\s{2,}/g, ' ').trim()
}

function runLocalMarketingOrchestrator(preview) {
  const segment = buildMarketingSegmentFromPreview(preview)
  const contactConfig = getMarketingContactModeConfig(preview?.contactMode)
  const plan = buildOrchestratorPlan(preview, segment)
  const pageId = getMetaPageId()
  const selectedImage = preview?.imageAsset || null
  const intelligence = buildMarketingIntelligence(preview, segment)
  const marketingAgentPrompt = buildMarketingAgentPrompt(preview, segment, selectedImage, intelligence)
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
    hook: buildExpertHook(segment, contactConfig),
    copy: buildExpertPrimaryCopy(segment, contactConfig),
    cta: contactConfig.copyCta,
    visualReference: segment.visualReference,
    city: segment.city,
    zones: segment.zones,
    service: segment.serviceLabel,
    zoneFocus: intelligence?.zoneInsights?.topZones?.map((item) => item.zone).join(', ') || '',
    audienceSegments: intelligence?.audienceInsights?.segments?.map((item) => item.label) || [],
    industry: segment.industry,
    role: segment.role,
    pain: segment.pain,
    consequence: segment.consequence,
    trigger: segment.trigger,
    strategicAngle: buildExpertStrategicAngle(segment),
    assumptions: [
      `Se tomo como base el concepto "${segment.serviceLabel}" con foco geografico en ${segment.city} y zonas ${segment.zoneLabel}.`,
      `El canal de contacto solicitado fue ${contactConfig.channelLabel}.`,
      'La promesa se mantiene concreta y sin metricas inventadas.',
    ],
  }

  const userDescription = String(preview.prePrompt || preview.campaignIdea || '').trim()
  const imageCreator = {
    dimensions: '1200x628',
    style: contactConfig.mode === 'whatsapp' ? 'Local service cercano y confiable' : 'Captacion local premium',
    prompt: [
      `Create a Facebook ad image for: "${userDescription || segment.serviceLabel}".`,
      `The campaign promotes: ${segment.serviceLabel} in ${segment.city}, Colombia.`,
      `Key zones: ${segment.zoneLabel}.`,
      `Target audience: ${segment.role} (${segment.industry}).`,
      `Pain point the ad addresses: ${segment.pain}`,
      `Hook/message: ${adsAnalyst.hook}`,
      `Visual direction: ${segment.visualReference}`,
      `The user specifically described: "${userDescription}". Make this the CENTRAL visual theme of the image.`,
      `Style: high-contrast, mobile-first, realistic photography, professional.`,
      `Campaign type: ${contactConfig.mode === 'whatsapp' ? 'WhatsApp conversation' : 'lead generation form'}.`,
      `IMPORTANT: The image must visually reflect "${userDescription}" — not a generic office scene. Be creative and specific to what the user described.`,
    ].join('\n'),
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
      intelligence?.zoneInsights?.summary || 'Analisis de zonas no activado.',
      intelligence?.audienceInsights?.summary || 'Segmentacion avanzada no activada.',
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
    seoAnalyzer: intelligence?.seoAnalyzer || {
      zoneSummary: 'Analisis SEO local no activado para esta ejecucion.',
      searchIntent: [],
      audienceSignals: [],
      recommendedContentAngles: [],
    },
    imageCreator,
    marketing,
    zoneInsights: intelligence?.zoneInsights || null,
    audienceInsights: intelligence?.audienceInsights || null,
    execution: {
      accountHint: String(getTargetAdAccountId()).startsWith('act_') ? getTargetAdAccountId() : `act_${getTargetAdAccountId()}`,
      accountId: getTargetAdAccountId(),
      pageId,
      campaignType: contactConfig.campaignType,
      campaignName,
      adsetName,
      leadFormName,
      budgetCap: preview.budget,
      formFields: contactConfig.formFields,
      prePrompt: String(preview?.prePrompt || '').trim(),
      segment,
      city: segment.city,
      zones: segment.zones,
      recommendedZones: intelligence?.zoneInsights?.topZones?.map((item) => item.zone) || [],
      audienceSegments: intelligence?.audienceInsights?.segments?.map((item) => item.label) || [],
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
