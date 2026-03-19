const { normalizeUiText } = require('../utils/helpers')

const CITY_ZONE_LIBRARY = {
  Bogota: ['Norte', 'Chapinero', 'Centro', 'Occidente', 'Sur', 'Suba', 'Usaquen'],
  Medellin: ['El Poblado', 'Laureles', 'Belen', 'Envigado', 'Sabaneta', 'Centro'],
  Cali: ['Norte', 'Sur', 'Oeste', 'Centro', 'Jamundi'],
  Barranquilla: ['Norte', 'Centro', 'Riomar', 'Soledad'],
  Cartagena: ['Bocagrande', 'Centro', 'Manga', 'Zona Norte'],
  Bucaramanga: ['Cabecera', 'Centro', 'Cacique', 'Floridablanca'],
}

const CATEGORY_PROFILES = {
  automotive: {
    preferredZones: ['Norte', 'Usaquen', 'Chapinero', 'Occidente', 'Suba'],
    searchSignals: ['comparacion de vehiculos', 'financiacion automotriz', 'concesionarios cercanos', 'carros usados premium'],
    contentAngles: ['comparativas y confianza', 'beneficio financiero', 'disponibilidad inmediata', 'estatus + practicidad'],
    audienceSignals: ['usuarios que siguen concesionarios', 'afinidad con test drives y financiamiento', 'intencion de cambio de vehiculo'],
    segments: (segment, city) => ([
      {
        label: `Profesionales 28-45 en ${city} con intencion de compra`,
        reason: `Buscan ${segment.serviceLabel.toLowerCase()} con respaldo, comparacion y facilidad de contacto.`,
        interests: ['vehiculos', 'concesionarios', 'financiacion', 'seguros'],
        intentSignals: ['visitas a portales automotrices', 'busquedas de precio', 'comparacion de modelos'],
      },
      {
        label: `Familias y parejas en ${city} evaluando cambio de carro`,
        reason: 'Responden bien a anuncios con confianza, seguridad y ahorro de tiempo.',
        interests: ['movilidad familiar', 'SUV', 'seguridad vial'],
        intentSignals: ['cotizaciones', 'usados certificados', 'agenda de prueba'],
      },
      {
        label: 'Entusiastas y comparadores de marca',
        reason: 'Son sensibles a creativos visuales, color, estilo y diferenciadores del vehiculo.',
        interests: ['marcas automotrices', 'accesorios', 'detailing'],
        intentSignals: ['seguimiento de lanzamientos', 'reviews', 'videos de prueba'],
      },
    ]),
  },
  pets: {
    preferredZones: ['Suba', 'Usaquen', 'Norte', 'Chapinero'],
    searchSignals: ['veterinaria cerca', 'vacunas para mascotas', 'grooming', 'urgencias menores'],
    contentAngles: ['cuidado preventivo', 'respuesta rapida', 'confianza y cercania'],
    audienceSignals: ['seguidores de pet shops', 'afinidad con bienestar animal', 'busquedas locales recurrentes'],
    segments: (_segment, city) => ([
      {
        label: `Duenos de mascotas 24-55 en ${city}`,
        reason: 'Alta respuesta cuando el anuncio transmite cercania, confianza y rapidez.',
        interests: ['mascotas', 'grooming', 'vacunas', 'pet shops'],
        intentSignals: ['consulta preventiva', 'vacunacion', 'servicios de grooming'],
      },
      {
        label: 'Familias con perros o gatos',
        reason: 'Convierten mejor con mensajes de cuidado, seguimiento y bienestar.',
        interests: ['bienestar animal', 'hogar', 'productos para mascotas'],
        intentSignals: ['reseñas de veterinarias', 'horarios extendidos', 'urgencias leves'],
      },
      {
        label: 'Usuarios activos en comunidades pet',
        reason: 'Tienden a compartir y reaccionar ante piezas con empatía y prueba social.',
        interests: ['comunidades pet', 'adopcion', 'salud animal'],
        intentSignals: ['preguntas frecuentes', 'comparacion de servicios', 'recomendaciones locales'],
      },
    ]),
  },
  dental: {
    preferredZones: ['Chapinero', 'Norte', 'Usaquen', 'Occidente'],
    searchSignals: ['valoracion dental', 'ortodoncia', 'implantes', 'limpieza dental'],
    contentAngles: ['confianza profesional', 'sonrisa y estetica', 'valoracion inicial'],
    audienceSignals: ['busquedas de salud oral', 'afinidad con estetica', 'agenda de citas'],
    segments: (_segment, city) => ([
      {
        label: `Adultos 24-55 en ${city} buscando valoracion`,
        reason: 'Responden a campañas con claridad, confianza y facilidad de agenda.',
        interests: ['odontologia', 'estetica dental', 'salud oral'],
        intentSignals: ['busqueda de especialistas', 'comparacion de tratamientos', 'agenda de cita'],
      },
      {
        label: 'Usuarios interesados en ortodoncia o implantes',
        reason: 'Valoran anuncios con proceso claro y promesa concreta.',
        interests: ['ortodoncia', 'implantes', 'blanqueamiento'],
        intentSignals: ['planes de pago', 'antes y despues', 'diagnostico inicial'],
      },
      {
        label: 'Pacientes de mantenimiento preventivo',
        reason: 'Buen fit para anuncios de limpieza y revision recurrente.',
        interests: ['salud preventiva', 'higiene dental'],
        intentSignals: ['profilaxis', 'chequeo anual', 'control odontologico'],
      },
    ]),
  },
  realestate: {
    preferredZones: ['Norte', 'Usaquen', 'Chapinero', 'Suba'],
    searchSignals: ['arriendo bogota', 'apartamentos en venta', 'inmobiliaria confiable', 'proyectos nuevos'],
    contentAngles: ['oportunidad real', 'filtro de opciones', 'acompanamiento confiable'],
    audienceSignals: ['seguidores de portales inmobiliarios', 'busqueda de mudanza', 'interes por inversion'],
    segments: (_segment, city) => ([
      {
        label: `Personas en ${city} interesadas en compra o arriendo`,
        reason: 'Buscan opciones filtradas, confianza y respuesta rapida.',
        interests: ['vivienda', 'inmobiliarias', 'financiacion'],
        intentSignals: ['busqueda de barrios', 'comparacion de inmuebles', 'solicitud de visita'],
      },
      {
        label: 'Parejas y familias en proceso de mudanza',
        reason: 'Conectan mejor con anuncios de seguridad, ubicacion y acompanamiento.',
        interests: ['hogar', 'familia', 'mudanza'],
        intentSignals: ['colegios cercanos', 'transporte', 'visitas agendadas'],
      },
      {
        label: 'Inversionistas locales',
        reason: 'Reaccionan mejor a mensajes de rentabilidad, plusvalia y oportunidad.',
        interests: ['inversion inmobiliaria', 'proyectos nuevos'],
        intentSignals: ['rentabilidad', 'proyectos VIS/no VIS', 'comparacion por zonas'],
      },
    ]),
  },
  beauty: {
    preferredZones: ['Chapinero', 'Norte', 'Usaquen', 'Centro'],
    searchSignals: ['spa cerca', 'peluqueria premium', 'barberia', 'estetica facial'],
    contentAngles: ['transformacion visible', 'reserva inmediata', 'beneficio emocional'],
    audienceSignals: ['afinidad con cuidado personal', 'seguidores de centros esteticos', 'busquedas por ubicacion'],
    segments: (_segment, city) => ([
      {
        label: `Adultos 22-45 en ${city} con afinidad por cuidado personal`,
        reason: 'Convierten mejor con piezas visuales y CTA de reserva inmediata.',
        interests: ['spa', 'barberia', 'estetica', 'peluqueria'],
        intentSignals: ['agenda de cita', 'promociones', 'antes y despues'],
      },
      {
        label: 'Usuarios sensibles a promociones de experiencia',
        reason: 'Responden a mensajes con escasez y prueba visual.',
        interests: ['belleza', 'bienestar', 'lifestyle'],
        intentSignals: ['cupos limitados', 'descuentos', 'packs'],
      },
      {
        label: 'Audiencia de recompra y mantenimiento',
        reason: 'Ideal para campañas de frecuencia y recordacion.',
        interests: ['rutinas de cuidado', 'tratamientos frecuentes'],
        intentSignals: ['repeticion de servicio', 'programacion mensual', 'fidelizacion'],
      },
    ]),
  },
  tech: {
    preferredZones: ['Chapinero', 'Norte', 'Usaquen', 'Centro'],
    searchSignals: ['automatizacion empresarial', 'software a la medida', 'crm', 'erp', 'ia aplicada'],
    contentAngles: ['eficiencia operativa', 'menos friccion', 'ROI', 'crecimiento ordenado'],
    audienceSignals: ['cargos decisores', 'seguidores de software B2B', 'busquedas de implementacion'],
    segments: (_segment, city) => ([
      {
        label: `Gerentes, founders y lideres de operaciones en ${city}`,
        reason: 'Necesitan resolver cuellos de botella y responden a propuestas concretas.',
        interests: ['software B2B', 'automatizacion', 'operaciones'],
        intentSignals: ['busquedas de ERP/CRM', 'escalamiento de procesos', 'solicitud de demo'],
      },
      {
        label: 'Empresas en crecimiento con procesos manuales',
        reason: 'Conectan con mensajes de ahorro de tiempo y orden operativo.',
        interests: ['productividad', 'IA', 'integraciones'],
        intentSignals: ['diagnostico', 'integracion de sistemas', 'casos de uso'],
      },
      {
        label: 'Areas comerciales y operativas con necesidad de trazabilidad',
        reason: 'Tienen alta afinidad con campañas que muestran impacto en KPIs.',
        interests: ['ventas', 'reporting', 'automatizacion'],
        intentSignals: ['pipeline', 'tiempos de respuesta', 'control operativo'],
      },
    ]),
  },
  general: {
    preferredZones: ['Norte', 'Chapinero', 'Usaquen', 'Suba'],
    searchSignals: ['busquedas locales de servicio', 'comparacion de proveedores', 'ubicacion cercana', 'contacto rapido'],
    contentAngles: ['beneficio directo', 'prueba social', 'accion inmediata'],
    audienceSignals: ['usuarios con interes local', 'audiencias de comparacion', 'busquedas por cercania'],
    segments: (segment, city) => ([
      {
        label: `Personas en ${city} con interes en ${segment.serviceLabel.toLowerCase()}`,
        reason: 'Estan mas cerca de escribir cuando el mensaje baja la friccion y deja claro el beneficio.',
        interests: ['servicios locales', 'soluciones por cercania'],
        intentSignals: ['busqueda local', 'comparacion de opciones', 'solicitud de informacion'],
      },
      {
        label: 'Audiencia que compara antes de decidir',
        reason: 'Necesita claridad, confianza y un CTA facil.',
        interests: ['resenas', 'recomendaciones', 'promociones'],
        intentSignals: ['preguntas frecuentes', 'contacto por WhatsApp', 'cotizacion'],
      },
      {
        label: 'Usuarios de conversion rapida',
        reason: 'Responden a propuestas concretas, localizadas y faciles de accionar.',
        interests: ['compra inmediata', 'servicios cercanos'],
        intentSignals: ['ubicacion', 'horarios', 'respuesta rapida'],
      },
    ]),
  },
}

function inferMarketCategory(text = '') {
  const normalized = normalizeUiText(text)
  if (/carro|carros|auto|autos|vehiculo|vehiculos|concesionario/.test(normalized)) return 'automotive'
  if (/veterin|mascota|pet|perro|gato/.test(normalized)) return 'pets'
  if (/odont|dental|sonrisa|ortodon/.test(normalized)) return 'dental'
  if (/inmobili|apartamento|casa|propiedad|arriendo|venta inmueble/.test(normalized)) return 'realestate'
  if (/belleza|spa|estetica|peluquer|barber|manicur/.test(normalized)) return 'beauty'
  if (/software|desarrollo|automatiz|erp|crm|rpa|saas|tecnolog/.test(normalized)) return 'tech'
  return 'general'
}

function getCategoryProfile(text = '') {
  const category = inferMarketCategory(text)
  return {
    category,
    profile: CATEGORY_PROFILES[category] || CATEGORY_PROFILES.general,
  }
}

function buildZoneIntelligence(preview = {}, segment = {}) {
  const enabled = Boolean(preview?.useZoneIntelligence)
  if (!enabled) return null

  const city = String(segment?.city || preview?.city || 'Bogota').trim() || 'Bogota'
  const selectedZones = Array.isArray(segment?.zones)
    ? segment.zones.map((zone) => String(zone || '').trim()).filter(Boolean)
    : []
  const cityZones = CITY_ZONE_LIBRARY[city] || selectedZones
  const baseText = [preview?.prePrompt, preview?.campaignIdea, segment?.serviceLabel, segment?.industry].filter(Boolean).join(' ')
  const { category, profile } = getCategoryProfile(baseText)
  const ranking = [...new Set([...profile.preferredZones, ...selectedZones])].filter((zone) => cityZones.includes(zone))
  const topZones = ranking.slice(0, Math.min(4, ranking.length || cityZones.length)).map((zone, index) => ({
    zone,
    scoreLabel: index === 0 ? 'Muy alta afinidad' : index === 1 ? 'Alta afinidad' : 'Afinidad recomendada',
    reason: selectedZones.includes(zone)
      ? `Coincide con el foco manual del usuario y con señales de demanda local para ${segment?.serviceLabel || 'la campana'}.`
      : `ads-analyst y seo-analyzer estiman mejor traccion local en ${zone} por afinidad con ${segment?.industry || 'la oferta'}.`,
    source: 'ads-analyst + seo-analyzer',
  }))

  return {
    category,
    summary: `ads-analyst y seo-analyzer priorizan ${topZones.map((item) => item.zone).join(', ') || city} como zonas con mejor mezcla de afinidad comercial y seguimiento local para ${segment?.serviceLabel || 'la campana'}.`,
    topZones,
    searchSignals: profile.searchSignals,
    contentAngles: profile.contentAngles,
    audienceSignals: profile.audienceSignals,
  }
}

function buildAudienceInsights(preview = {}, segment = {}, zoneInsights = null) {
  const enabled = Boolean(preview?.useAudienceSegmentation)
  if (!enabled) return null

  const city = String(segment?.city || preview?.city || 'Colombia').trim() || 'Colombia'
  const baseText = [preview?.prePrompt, preview?.campaignIdea, segment?.serviceLabel, segment?.industry].filter(Boolean).join(' ')
  const { profile } = getCategoryProfile(baseText)
  const segments = profile.segments(segment, city)

  return {
    summary: `Segmentacion sugerida para atraer clientes potenciales en ${city}${zoneInsights?.topZones?.length ? ` con foco en ${zoneInsights.topZones.map((item) => item.zone).join(', ')}` : ''}.`,
    segments,
  }
}

function buildMarketingIntelligence(preview = {}, segment = {}) {
  const zoneInsights = buildZoneIntelligence(preview, segment)
  const audienceInsights = buildAudienceInsights(preview, segment, zoneInsights)

  return {
    zoneInsights,
    audienceInsights,
    seoAnalyzer: {
      zoneSummary: zoneInsights?.summary || 'Analisis SEO local no activado para esta ejecucion.',
      searchIntent: zoneInsights?.searchSignals || [],
      audienceSignals: zoneInsights?.audienceSignals || audienceInsights?.segments.flatMap((item) => item.intentSignals).slice(0, 4) || [],
      recommendedContentAngles: zoneInsights?.contentAngles || [],
    },
  }
}

module.exports = {
  buildMarketingIntelligence,
}
