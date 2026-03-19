import { CITY_ZONE_OPTIONS } from './constants'

function normalizeText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function escapeRegex(value: string) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function inferPrePromptCategory(text: string) {
  const normalized = normalizeText(text)

  if (/carro|carros|auto|autos|vehiculo|vehiculos|concesionario/.test(normalized)) return 'automotive'
  if (/veterin|mascota|pet|perro|gato/.test(normalized)) return 'pets'
  if (/odont|dental|sonrisa|ortodon/.test(normalized)) return 'dental'
  if (/inmobili|apartamento|casa|propiedad|arriendo|venta inmueble/.test(normalized)) return 'realestate'
  if (/belleza|spa|estetica|peluquer|barber|manicur/.test(normalized)) return 'beauty'
  if (/software|desarrollo|automatiz|erp|crm|rpa|saas|tecnolog/.test(normalized)) return 'tech'
  return 'general'
}

function getSuggestedZones(city: string, text: string, selectedZones: string[]) {
  const cityZones = CITY_ZONE_OPTIONS[city] || []
  const selected = selectedZones.filter((zone) => cityZones.includes(zone))
  const category = inferPrePromptCategory(text)
  const rankingByCity: Record<string, Record<string, string[]>> = {
    Bogota: {
      automotive: ['Norte', 'Usaquen', 'Chapinero', 'Occidente', 'Suba'],
      pets: ['Suba', 'Usaquen', 'Norte', 'Chapinero'],
      dental: ['Chapinero', 'Norte', 'Usaquen', 'Occidente'],
      realestate: ['Norte', 'Usaquen', 'Chapinero', 'Suba'],
      beauty: ['Chapinero', 'Norte', 'Usaquen', 'Centro'],
      tech: ['Chapinero', 'Norte', 'Usaquen', 'Centro'],
      general: ['Norte', 'Chapinero', 'Usaquen', 'Suba'],
    },
    Medellin: {
      automotive: ['El Poblado', 'Laureles', 'Envigado', 'Sabaneta'],
      pets: ['Laureles', 'El Poblado', 'Envigado', 'Sabaneta'],
      dental: ['El Poblado', 'Laureles', 'Envigado', 'Centro'],
      realestate: ['El Poblado', 'Envigado', 'Laureles', 'Sabaneta'],
      beauty: ['El Poblado', 'Laureles', 'Envigado', 'Centro'],
      tech: ['El Poblado', 'Laureles', 'Centro', 'Envigado'],
      general: ['El Poblado', 'Laureles', 'Envigado', 'Centro'],
    },
    Cali: {
      automotive: ['Norte', 'Sur', 'Oeste', 'Jamundi'],
      pets: ['Sur', 'Norte', 'Oeste', 'Jamundi'],
      dental: ['Sur', 'Norte', 'Centro', 'Oeste'],
      realestate: ['Sur', 'Jamundi', 'Norte', 'Oeste'],
      beauty: ['Sur', 'Norte', 'Oeste', 'Centro'],
      tech: ['Norte', 'Sur', 'Centro', 'Oeste'],
      general: ['Norte', 'Sur', 'Oeste', 'Centro'],
    },
    Barranquilla: {
      automotive: ['Riomar', 'Norte', 'Soledad', 'Centro'],
      pets: ['Riomar', 'Norte', 'Centro', 'Soledad'],
      dental: ['Norte', 'Riomar', 'Centro', 'Soledad'],
      realestate: ['Riomar', 'Norte', 'Centro', 'Soledad'],
      beauty: ['Norte', 'Riomar', 'Centro', 'Soledad'],
      tech: ['Norte', 'Riomar', 'Centro', 'Soledad'],
      general: ['Norte', 'Riomar', 'Centro', 'Soledad'],
    },
    Cartagena: {
      automotive: ['Zona Norte', 'Bocagrande', 'Manga', 'Centro'],
      pets: ['Bocagrande', 'Zona Norte', 'Centro', 'Manga'],
      dental: ['Bocagrande', 'Centro', 'Zona Norte', 'Manga'],
      realestate: ['Zona Norte', 'Bocagrande', 'Manga', 'Centro'],
      beauty: ['Bocagrande', 'Centro', 'Zona Norte', 'Manga'],
      tech: ['Bocagrande', 'Centro', 'Zona Norte', 'Manga'],
      general: ['Bocagrande', 'Centro', 'Zona Norte', 'Manga'],
    },
    Bucaramanga: {
      automotive: ['Cabecera', 'Cacique', 'Floridablanca', 'Centro'],
      pets: ['Cabecera', 'Floridablanca', 'Cacique', 'Centro'],
      dental: ['Cabecera', 'Cacique', 'Centro', 'Floridablanca'],
      realestate: ['Cabecera', 'Floridablanca', 'Cacique', 'Centro'],
      beauty: ['Cabecera', 'Cacique', 'Floridablanca', 'Centro'],
      tech: ['Cabecera', 'Centro', 'Floridablanca', 'Cacique'],
      general: ['Cabecera', 'Centro', 'Floridablanca', 'Cacique'],
    },
  }
  const cityRanking = rankingByCity[city] || {}
  const ordered = [...(cityRanking[category] || cityRanking.general || []), ...cityZones, ...selected]
  const uniqueZones = [...new Set(ordered)].filter((zone) => cityZones.includes(zone))
  return uniqueZones.length > 0 ? uniqueZones.slice(0, 4) : cityZones.slice(0, 4)
}

function getSuggestedCities(text: string) {
  const category = inferPrePromptCategory(text)
  const rankingByCategory: Record<string, string[]> = {
    automotive: ['Bogota', 'Medellin', 'Cali', 'Barranquilla', 'Bucaramanga', 'Pereira'],
    pets: ['Bogota', 'Medellin', 'Bucaramanga', 'Cali', 'Pereira', 'Manizales'],
    dental: ['Bogota', 'Medellin', 'Cali', 'Bucaramanga', 'Pereira', 'Armenia'],
    realestate: ['Bogota', 'Medellin', 'Cartagena', 'Cali', 'Barranquilla', 'SantaMarta'],
    beauty: ['Bogota', 'Medellin', 'Cali', 'Barranquilla', 'Pereira', 'Bucaramanga'],
    tech: ['Bogota', 'Medellin', 'Cali', 'Barranquilla', 'Bucaramanga', 'Villavicencio'],
    general: ['Bogota', 'Medellin', 'Cali', 'Barranquilla', 'Cartagena', 'Bucaramanga'],
  }
  const prioritized = rankingByCategory[category] || rankingByCategory.general
  const allCities = Object.keys(CITY_ZONE_OPTIONS)
  return [...new Set([...prioritized, ...allCities])]
}

function getSuggestedAudienceSegments(text: string, city: string) {
  const category = inferPrePromptCategory(text)
  const segmentMap: Record<string, string[]> = {
    automotive: [
      `Profesionales 28-45 en ${city} con interes en compra, financiamiento o cambio de vehiculo`,
      `Familias con necesidad de movilidad y comparacion activa de carros`,
      'Usuarios que siguen concesionarios, accesorios o marketplaces automotrices',
    ],
    pets: [
      `Familias y duenos de mascotas en ${city} con busqueda activa de cuidado preventivo`,
      'Personas interesadas en grooming, vacunas, consultas y bienestar animal',
      'Usuarios que siguen veterinarias, pet shops y comunidades de mascotas',
    ],
    dental: [
      `Adultos 24-55 en ${city} interesados en salud oral, ortodoncia o estetica dental`,
      'Usuarios que comparan valoraciones, limpieza, brackets o implantes',
      'Personas con intencion de agendar cita o valoracion',
    ],
    realestate: [
      `Personas en ${city} interesadas en compra, arriendo o inversion inmobiliaria`,
      'Usuarios que consultan portales de vivienda y asesores de bienes raices',
      'Familias y parejas con alta intencion de mudanza',
    ],
    beauty: [
      `Mujeres y hombres en ${city} interesados en cuidado personal y cambios de imagen`,
      'Usuarios que siguen centros esteticos, spa, barberias o peluquerias',
      'Personas con alta afinidad a promociones y reservas por mensaje',
    ],
    tech: [
      `Gerentes, founders y lideres de operaciones en ${city} con necesidad de automatizacion`,
      'Empresas que estan escalando procesos y buscan eficiencia comercial u operativa',
      'Equipos interesados en software, IA, CRM, ERP o desarrollo a la medida',
    ],
    general: [
      `Personas en ${city} con interes directo en ${text || 'la oferta anunciada'}`,
      'Usuarios que comparan opciones locales antes de escribir o dejar sus datos',
      'Audiencia con afinidad por soluciones cercanas y de respuesta rapida',
    ],
  }

  return segmentMap[category] || segmentMap.general
}

export function buildMarketingPromptPreview(params: {
  campaignIdea: string
  city: string
  zones: string[]
  contactMode: 'lead_form' | 'whatsapp'
  budget: string
  startDate: string
  endDate: string
}) {
  const campaignIdea = params.campaignIdea.trim()
  const city = params.city.trim()
  const zonesLabel = params.zones.length > 0 ? params.zones.join(', ') : 'toda la ciudad'
  const contactLabel = params.contactMode === 'whatsapp'
    ? 'generar conversaciones por WhatsApp'
    : 'captar clientes potenciales desde el sitio web'
  const objectiveLabel = params.contactMode === 'whatsapp' ? 'Mensajes / WhatsApp' : 'Clientes potenciales'
  const budgetLabel = params.budget.trim() || 'pendiente'
  const dateLabel = params.startDate && params.endDate
    ? `${params.startDate} -> ${params.endDate}`
    : 'pendiente'

  if (!campaignIdea || !city) return ''

  return [
    `Quiero una campana de Facebook Ads para "${campaignIdea}".`,
    `Ciudad objetivo: ${city}.`,
    `Zonas prioritarias: ${zonesLabel}.`,
    `Objetivo principal: ${objectiveLabel}.`,
    `Canal de contacto: ${contactLabel}.`,
    `Presupuesto estimado: ${budgetLabel}.`,
    `Fechas de campana: ${dateLabel}.`,
    'Genera un brief completo usando el ads-analyst, image-creator y marketing con esta estructura:',
    '1. copy sugerido del anuncio',
    '2. publico recomendado',
    '3. hook principal',
    '4. CTA recomendado',
    '5. direccion visual de la imagen',
    '6. recomendacion de segmentacion local',
    `La imagen debe estar directamente relacionada con "${campaignIdea}" y sentirse coherente con ${city}.`,
  ].join('\n')
}

export function buildSuggestedCityZoneOptions(params: {
  prePrompt: string
  selectedCity: string
  selectedZones: string[]
}) {
  const baseText = String(params.prePrompt || '').trim()
  if (!baseText) return []

  return getSuggestedCities(baseText).map((city) => {
    const zones = getSuggestedZones(
      city,
      baseText,
      params.selectedCity === city ? params.selectedZones : []
    )

    return {
      city,
      zones,
      summary: zones.length > 0
        ? `${city}: ${zones.join(', ')}`
        : `${city}: el orquestador revisara las mejores zonas.`,
    }
  })
}

export function buildTrendOptions(params: {
  prePrompt: string
  selectedCity: string
  selectedZones: string[]
}) {
  const cityOptions = buildSuggestedCityZoneOptions(params)
  const baseText = String(params.prePrompt || '').trim()

  return cityOptions.map((option, index) => {
    const audienceSegments = getSuggestedAudienceSegments(baseText, option.city)
    return {
      id: index + 1,
      label: `Tendencia ${String(index + 1).padStart(2, '0')}`,
      city: option.city,
      zones: option.zones,
      summary: `Mayor afinidad comercial detectada en ${option.city} para posibles compradores de esta campaña.`,
      buyerIntent: audienceSegments[0] || `Posibles compradores con interes en ${baseText || 'la oferta anunciada'}.`,
      audienceSignals: audienceSegments.slice(1, 3),
    }
  })
}

export function extractMarketingDraftFromPrePrompt(prePrompt: string) {
  const raw = String(prePrompt || '').trim()
  if (!raw) {
    return { campaignIdea: '', city: '', zones: [] as string[] }
  }

  let detectedCity = ''
  for (const cityOption of Object.keys(CITY_ZONE_OPTIONS)) {
    if (new RegExp(`\\b${escapeRegex(cityOption)}\\b`, 'i').test(raw)) {
      detectedCity = cityOption
      break
    }
  }

  const detectedZones = detectedCity
    ? CITY_ZONE_OPTIONS[detectedCity].filter((zone) => new RegExp(`\\b${escapeRegex(zone)}\\b`, 'i').test(raw))
    : []

  let campaignIdea = raw
  if (detectedCity) {
    campaignIdea = campaignIdea.replace(
      new RegExp(`\\b(?:en\\s+la\\s+ciudad\\s+de|ciudad\\s+de|en)\\s+${escapeRegex(detectedCity)}\\b`, 'ig'),
      ' '
    )
  }

  for (const zone of detectedZones) {
    campaignIdea = campaignIdea.replace(
      new RegExp(`\\b(?:en\\s+el|en\\s+la|zona\\s+de|sector\\s+de)?\\s*${escapeRegex(zone)}\\b`, 'ig'),
      ' '
    )
  }

  campaignIdea = campaignIdea
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')

  return {
    campaignIdea: campaignIdea || raw,
    city: detectedCity,
    zones: detectedZones,
  }
}

export function buildZoneIntelligencePreview(params: {
  enabled: boolean
  prePrompt: string
  campaignIdea: string
  city: string
  selectedZones: string[]
}) {
  if (!params.enabled) {
    return 'Activa el check para que ads-analyst y seo-analyzer sugieran zonas calientes.'
  }

  if (!params.city) {
    return 'Aplica el pre-prompt o selecciona una ciudad para calcular zonas con mayor afinidad.'
  }

  const suggestedZones = getSuggestedZones(
    params.city,
    `${params.prePrompt} ${params.campaignIdea}`.trim(),
    params.selectedZones
  )

  if (suggestedZones.length === 0) {
    return `El orquestador revisara la ciudad ${params.city} para detectar zonas con mejor traccion.`
  }

  return `Zonas con mayor afinidad estimada para esta campana en ${params.city}: ${suggestedZones.join(', ')}.`
}

export function buildAudienceSegmentationPreview(params: {
  enabled: boolean
  prePrompt: string
  campaignIdea: string
  city: string
}) {
  if (!params.enabled) {
    return 'Activa el check para que ads-analyst y seo-analyzer segmenten el publico objetivo.'
  }

  if (!params.city && !params.campaignIdea && !params.prePrompt) {
    return 'Completa el pre-prompt para sugerir segmentos de publico.'
  }

  const cityLabel = params.city || 'la ciudad objetivo'
  const segments = getSuggestedAudienceSegments(
    `${params.prePrompt} ${params.campaignIdea}`.trim(),
    cityLabel
  )

  return segments.slice(0, 2).join(' | ')
}
