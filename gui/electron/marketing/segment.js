const {
  normalizeUiText,
  getDefaultLeadFormFieldLabels,
  getDefaultLeadFormRequiredKeys,
} = require('../utils/helpers')

function getDefaultMarketingSegment() {
  return {
    key: 'logistics-ops-co',
    shortLabel: 'Logistics Ops CO',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Logistics & Distribution',
    role: 'Operations Manager',
    companySize: '20-80 employees',
    pain: 'Manual dispatch assignment, route updates by WhatsApp, and late delivery notifications.',
    consequence: 'Delivery delays, SLA breaches, and a high coordination cost.',
    trigger: 'Active hiring in operations, expansion to new cities, or rising shipment volume.',
    affectedKpi: 'On-time delivery, cost per route, and claims rate.',
    categoryStatement: 'Specialists in eliminating operational friction for growth-stage companies before chaos scales.',
    strategicAngle: 'Operational chaos in dispatch and tracking is usually a systems problem, not a staffing problem.',
    primaryCta: 'If useful, I can share a 3-bullet diagnosis for dispatch + tracking in 24h.',
    hook: 'Reduce dispatch friction before delivery chaos scales.',
    visualReference: 'Operations team in a Colombian logistics company, dispatch board, route tracking dashboard, warehouse activity, premium B2B tech aesthetic.',
    ageMin: 24,
    ageMax: 54,
  }
}

function getMarketingContactModeConfig(contactMode = 'lead_form') {
  if (String(contactMode || '').trim() === 'whatsapp') {
    return {
      mode: 'whatsapp',
      channelLabel: 'WhatsApp',
      objectiveLabel: 'Mensajes / WhatsApp',
      campaignType: 'WhatsApp',
      copyCta: 'Enviar mensaje',
      creativeCta: 'WHATSAPP_MESSAGE',
      formFields: ['Conversacion por WhatsApp'],
      requiredKeys: [],
    }
  }

  return {
    mode: 'lead_form',
    channelLabel: 'Formulario instantaneo',
    objectiveLabel: 'Clientes potenciales',
    campaignType: 'Instant Form',
    copyCta: 'Registrarte',
    creativeCta: 'SIGN_UP',
    formFields: getDefaultLeadFormFieldLabels(),
    requiredKeys: getDefaultLeadFormRequiredKeys(),
  }
}

function buildMarketingZoneLabel(zones = []) {
  const cleaned = Array.isArray(zones)
    ? zones.map((value) => String(value || '').trim()).filter(Boolean)
    : []
  return cleaned.length > 0 ? cleaned.join(', ') : 'toda la ciudad'
}

function slugifyMarketingValue(value) {
  return normalizeUiText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'segment'
}

function inferCampaignProfile(campaignIdea = '') {
  const normalized = normalizeUiText(campaignIdea)

  if (/veterin|mascota|pet|perro|gato/.test(normalized)) {
    return {
      industry: 'Servicios veterinarios',
      role: 'duenos de mascotas y familias con perros o gatos',
      companySize: 'hogares con mascotas',
      pain: 'Necesitan atencion veterinaria confiable, cercana y rapida para su mascota.',
      consequence: 'Retrasar una revision, vacuna o atencion preventiva aumenta el estres y el riesgo para la mascota.',
      trigger: 'Vacunas, desparasitacion, grooming, consulta preventiva o urgencia menor.',
      affectedKpi: 'Reservas, consultas y reactivacion de clientes.',
      categoryStatement: 'Servicio veterinario cercano que transmite confianza y rapidez para el cuidado de mascotas.',
      strategicAngle: 'La salud de tu mascota merece atencion profesional sin vueltas ni esperas largas.',
      hook: 'Cuida a tu mascota con atencion veterinaria cercana.',
      visualReference: 'Veterinario profesional atendiendo a un perro o un gato en un entorno limpio, cercano y confiable.',
      ageMin: 24,
      ageMax: 55,
    }
  }

  if (/odont|dental|sonrisa|ortodon/.test(normalized)) {
    return {
      industry: 'Salud dental',
      role: 'adultos interesados en mejorar su salud oral o estetica dental',
      companySize: 'consumidores locales',
      pain: 'Quieren resolver molestias, mejorar su sonrisa o agendar una valoracion confiable.',
      consequence: 'Postergar el tratamiento suele aumentar el costo y el malestar.',
      trigger: 'Limpieza, ortodoncia, implantes o valoracion odontologica.',
      affectedKpi: 'Citas agendadas y valoraciones.',
      categoryStatement: 'Servicio odontologico local orientado a confianza, cercania y conversion de citas.',
      strategicAngle: 'Una valoracion a tiempo evita tratamientos mas largos y costosos.',
      hook: 'Agenda tu valoracion dental con confianza.',
      visualReference: 'Consultorio odontologico moderno, sonrisa saludable y trato cercano.',
      ageMin: 24,
      ageMax: 55,
    }
  }

  if (/inmobili|apartamento|casa|propiedad|arriendo|venta inmueble/.test(normalized)) {
    return {
      industry: 'Bienes raices',
      role: 'personas interesadas en comprar, vender o arrendar vivienda',
      companySize: 'consumidores locales',
      pain: 'Necesitan una opcion confiable y clara para encontrar o mover una propiedad.',
      consequence: 'Sin acompanamiento se pierde tiempo en opciones poco adecuadas o contactos de baja calidad.',
      trigger: 'Mudanza, inversion o necesidad de vender rapido.',
      affectedKpi: 'Leads calificados y visitas agendadas.',
      categoryStatement: 'Campana inmobiliaria enfocada en captar interesados con alta intencion.',
      strategicAngle: 'Una buena asesoria ahorra tiempo y evita decisiones costosas.',
      hook: 'Encuentra tu proxima propiedad con mejor filtro.',
      visualReference: 'Propiedad atractiva, asesor confiable y sensacion de oportunidad real.',
      ageMin: 26,
      ageMax: 58,
    }
  }

  return {
    industry: 'Servicios locales',
    role: `personas con interes o necesidad relacionada con ${campaignIdea || 'la oferta anunciada'}`,
    companySize: 'consumidores locales',
    pain: `Necesitan una solucion confiable relacionada con ${campaignIdea || 'el servicio anunciado'}.`,
    consequence: 'Si no encuentran una opcion clara, retrasan la compra o terminan eligiendo una alternativa menos conveniente.',
    trigger: 'Busqueda activa, necesidad inmediata o interes reciente en el servicio.',
    affectedKpi: 'Contactos calificados y conversaciones comerciales.',
    categoryStatement: `Campana local orientada a convertir interes en contacto para ${campaignIdea || 'el servicio'}.`,
    strategicAngle: `La mejor respuesta comercial conecta la necesidad del usuario con una accion inmediata sobre ${campaignIdea || 'la oferta'}.`,
    hook: `Haz visible ${campaignIdea || 'tu oferta'} donde ya te estan buscando.`,
    visualReference: `Escena comercial limpia y aspiracional relacionada con ${campaignIdea || 'el servicio anunciado'}.`,
    ageMin: 24,
    ageMax: 55,
  }
}

function buildMarketingSegmentFromPreview(preview = {}) {
  const campaignIdea = String(preview?.campaignIdea || '').trim() || 'Campana local'
  const city = String(preview?.city || '').trim() || 'Bogota'
  const zones = Array.isArray(preview?.zones)
    ? preview.zones.map((value) => String(value || '').trim()).filter(Boolean)
    : []
  const zoneLabel = buildMarketingZoneLabel(zones)
  const contactConfig = getMarketingContactModeConfig(preview?.contactMode)
  const profile = inferCampaignProfile(campaignIdea)
  const shortBaseLabel = campaignIdea.length > 24 ? `${campaignIdea.slice(0, 21).trim()}...` : campaignIdea

  return {
    key: `${slugifyMarketingValue(campaignIdea)}-${slugifyMarketingValue(city)}`,
    shortLabel: `${shortBaseLabel} | ${city}`,
    serviceLabel: campaignIdea,
    city,
    zones,
    zoneLabel,
    contactMode: contactConfig.mode,
    contactChannelLabel: contactConfig.channelLabel,
    country: 'Colombia',
    countryCode: 'CO',
    industry: profile.industry,
    role: profile.role,
    companySize: profile.companySize,
    pain: profile.pain,
    consequence: profile.consequence,
    trigger: profile.trigger,
    affectedKpi: profile.affectedKpi,
    categoryStatement: profile.categoryStatement,
    strategicAngle: profile.strategicAngle,
    primaryCta: contactConfig.mode === 'whatsapp'
      ? `Escribenos por WhatsApp para recibir informacion sobre ${campaignIdea}.`
      : `Dejanos tus datos y te contactamos sobre ${campaignIdea}.`,
    hook: profile.hook,
    visualReference: `${profile.visualReference} La pieza debe sentirse localizada en ${city} y priorizar las zonas ${zoneLabel}.`,
    ageMin: profile.ageMin,
    ageMax: profile.ageMax,
  }
}

function buildAudienceSummary(segment = getDefaultMarketingSegment()) {
  const locationBits = [segment.city, segment.zoneLabel].filter(Boolean)
  return `${segment.country}${locationBits.length > 0 ? ` | ${locationBits.join(' | ')}` : ''} | ${segment.industry} | ${segment.role}`
}

function buildTargetingSummary(segment = getDefaultMarketingSegment()) {
  const locationBits = [segment.city, segment.zoneLabel].filter(Boolean)
  return `${segment.country}${locationBits.length > 0 ? `, ${locationBits.join(', ')}` : ''}, ${segment.role}, ${segment.industry}, ${segment.ageMin}-${segment.ageMax}`
}

module.exports = {
  getDefaultMarketingSegment,
  getMarketingContactModeConfig,
  buildMarketingZoneLabel,
  slugifyMarketingValue,
  inferCampaignProfile,
  buildMarketingSegmentFromPreview,
  buildAudienceSummary,
  buildTargetingSummary,
}
