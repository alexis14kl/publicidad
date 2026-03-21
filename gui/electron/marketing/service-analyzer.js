const { normalizeUiText } = require('../utils/helpers')

function titleCase(value = '') {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function normalize(value = '') {
  return normalizeUiText(String(value || ''))
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function scoreKeywords(text, keywords = []) {
  return keywords.reduce((total, keyword) => {
    const normalizedKeyword = normalize(keyword)
    if (!normalizedKeyword) return total
    const pattern = normalizedKeyword
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => escapeRegex(part))
      .join('\\s+')
    const regex = new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'i')
    return total + (regex.test(text) ? 1 : 0)
  }, 0)
}

function pushSuggestion(bucket, label, reason, score) {
  const cleanLabel = titleCase(String(label || ''))
  if (!cleanLabel) return
  const key = normalize(cleanLabel)
  const existing = bucket.get(key)
  if (!existing || score > existing.score) {
    bucket.set(key, {
      value: cleanLabel,
      label: cleanLabel,
      reason: String(reason || '').trim(),
      score: Number(score || 0),
    })
  }
}

function addSoftwareSuggestions(text, bucket) {
  const softwareScore = scoreKeywords(text, [
    'software', 'desarrollo', 'desarrollador', 'app', 'aplicacion', 'aplicaciones',
    'sistema', 'erp', 'crm', 'saas', 'web', 'programador', 'programacion',
  ])
  const automationScore = scoreKeywords(text, [
    'automatizacion', 'automatizar', 'rpa', 'bot', 'chatbot', 'workflow', 'flujo', 'agente',
  ])
  const hiringScore = scoreKeywords(text, ['vacante', 'vacantes', 'empleo', 'talento', 'reclutamiento'])
  const mobileScore = scoreKeywords(text, ['movil', 'mobile', 'android', 'ios'])
  if (softwareScore + automationScore + hiringScore + mobileScore === 0) return

  pushSuggestion(bucket, 'Desarrollo a la medida', 'El analizador detecto una necesidad de software o sistemas personalizados.', 120 + softwareScore)
  pushSuggestion(bucket, 'Automatizaciones empresariales', 'Detecte procesos, eficiencia operativa o automatizacion para empresas.', 116 + automationScore)
  pushSuggestion(bucket, 'RPAs nativos', 'El contexto habla de bots, RPA o tareas repetitivas automatizables.', 112 + automationScore)
  pushSuggestion(bucket, 'Desarrollo desktop', 'La necesidad encaja con herramientas de escritorio o software operativo.', 100 + softwareScore)
  if (mobileScore > 0) {
    pushSuggestion(bucket, 'Aplicaciones moviles', 'Se detecto una necesidad de apps moviles o producto para celular.', 114 + mobileScore)
    pushSuggestion(bucket, 'Desarrollo Android', 'El texto menciona Android, iOS o movilidad.', 108 + mobileScore)
  }
  if (hiringScore > 0) {
    pushSuggestion(bucket, 'Trabaja con nosotros', 'El servicio parece orientado a vacantes o captacion de talento.', 110 + hiringScore)
  }
}

function addVeterinarySuggestions(text, bucket) {
  const baseScore = scoreKeywords(text, ['veterinaria', 'veterinario', 'mascota', 'mascotas', 'perro', 'perros', 'gato', 'gatos', 'petshop', 'pet shop', 'canino', 'felino'])
  if (!baseScore) return
  const groomingScore = scoreKeywords(text, ['peluqueria', 'grooming', 'bano', 'baño', 'spa'])
  const foodScore = scoreKeywords(text, ['comida', 'alimento', 'concentrado', 'croquetas', 'snack'])
  const toyScore = scoreKeywords(text, ['juguete', 'juguetes', 'accesorio', 'accesorios'])
  const consultScore = scoreKeywords(text, ['consulta', 'vacuna', 'desparasitacion', 'cirugia', 'urgencia'])

  if (groomingScore > 0) pushSuggestion(bucket, 'Peluqueria para mascotas', 'Detecte grooming o cuidado estetico para mascotas.', 118 + groomingScore)
  if (foodScore > 0) pushSuggestion(bucket, 'Alimento para perros y gatos', 'El usuario parece promocionar comida o concentrado para mascotas.', 116 + foodScore)
  if (toyScore > 0) pushSuggestion(bucket, 'Juguetes para perros y gatos', 'El pre-prompt encaja con accesorios o juguetes para mascotas.', 114 + toyScore)
  if (consultScore > 0 || groomingScore + foodScore + toyScore === 0) {
    pushSuggestion(bucket, 'Consulta veterinaria', 'Se detecto un servicio veterinario o de salud para mascotas.', 112 + consultScore + baseScore)
    pushSuggestion(bucket, 'Servicios veterinarios', 'El negocio pertenece claramente al sector veterinario.', 108 + baseScore)
  }
}

function addGamingSuggestions(text, bucket) {
  const baseScore = scoreKeywords(text, ['videojuego', 'videojuegos', 'gaming', 'consola', 'consolas', 'playstation', 'xbox', 'nintendo', 'steam'])
  if (!baseScore) return
  pushSuggestion(bucket, 'Venta de videojuegos', 'El pre-prompt habla directamente de videojuegos o productos gamer.', 120 + baseScore)
  if (scoreKeywords(text, ['consola', 'playstation', 'xbox', 'nintendo']) > 0) {
    pushSuggestion(bucket, 'Venta de consolas', 'Detecte consolas o hardware gamer.', 112 + baseScore)
  }
  if (scoreKeywords(text, ['control', 'controles', 'audifono', 'mouse', 'teclado', 'silla gamer', 'accesorio']) > 0) {
    pushSuggestion(bucket, 'Accesorios gamer', 'El usuario parece vender perifericos o accesorios gamer.', 110 + baseScore)
  }
  if (scoreKeywords(text, ['gift card', 'codigo', 'codigo digital', 'recarga']) > 0) {
    pushSuggestion(bucket, 'Recargas y codigos digitales', 'El contexto sugiere productos digitales o recargas.', 108 + baseScore)
  }
}

function addAutomotiveSuggestions(text, bucket) {
  const baseScore = scoreKeywords(text, ['carro', 'carros', 'auto', 'autos', 'vehiculo', 'vehiculos', 'moto', 'motos', 'concesionario'])
  if (!baseScore) return
  pushSuggestion(bucket, 'Venta de vehiculos', 'El pre-prompt se orienta a una campana automotriz.', 120 + baseScore)
  if (scoreKeywords(text, ['usado', 'usados', 'segunda']) > 0) pushSuggestion(bucket, 'Venta de carros usados', 'Detecte interes en autos usados.', 112 + baseScore)
  if (scoreKeywords(text, ['credito', 'financiacion', 'financiamiento', 'cuotas', 'leasing']) > 0) pushSuggestion(bucket, 'Financiacion de vehiculos', 'El contexto habla de credito o financiacion.', 110 + baseScore)
  if (scoreKeywords(text, ['repuesto', 'repuestos', 'llanta', 'accesorio']) > 0) pushSuggestion(bucket, 'Repuestos y accesorios', 'La oferta parece enfocada en repuestos o accesorios.', 108 + baseScore)
}

function addBeautySuggestions(text, bucket) {
  if (scoreKeywords(text, ['veterinaria', 'mascota', 'mascotas', 'perro', 'gato', 'petshop', 'pet shop']) > 0) {
    return
  }
  const baseScore = scoreKeywords(text, ['belleza', 'spa', 'estetica', 'peluqueria', 'barberia', 'manicure', 'pedicure', 'facial'])
  if (!baseScore) return
  pushSuggestion(bucket, 'Peluqueria y barberia', 'El pre-prompt pertenece a belleza, barberia o peluqueria.', 118 + baseScore)
  pushSuggestion(bucket, 'Spa y estetica', 'Detecte servicios de cuidado personal y estetica.', 114 + baseScore)
  if (scoreKeywords(text, ['manicure', 'pedicure', 'unas']) > 0) {
    pushSuggestion(bucket, 'Manicure y pedicure', 'El texto menciona servicios de unas.', 110 + baseScore)
  }
}

function addDentalSuggestions(text, bucket) {
  const baseScore = scoreKeywords(text, ['odontologia', 'odontologico', 'dental', 'sonrisa', 'ortodoncia', 'brackets', 'implante'])
  if (!baseScore) return
  pushSuggestion(bucket, 'Valoracion odontologica', 'El pre-prompt apunta a odontologia o salud dental.', 118 + baseScore)
  if (scoreKeywords(text, ['ortodoncia', 'brackets']) > 0) pushSuggestion(bucket, 'Ortodoncia', 'Detecte una necesidad de ortodoncia.', 112 + baseScore)
  if (scoreKeywords(text, ['limpieza', 'profilaxis']) > 0) pushSuggestion(bucket, 'Limpieza dental', 'El contexto encaja con higiene oral.', 108 + baseScore)
}

function addRealEstateSuggestions(text, bucket) {
  const baseScore = scoreKeywords(text, ['inmobiliaria', 'apartamento', 'casa', 'propiedad', 'arriendo', 'alquiler', 'finca'])
  if (!baseScore) return
  pushSuggestion(bucket, 'Venta de inmuebles', 'Se detecto una campana inmobiliaria.', 118 + baseScore)
  if (scoreKeywords(text, ['arriendo', 'alquiler', 'renta']) > 0) pushSuggestion(bucket, 'Arriendo de inmuebles', 'El servicio parece centrado en arriendos.', 112 + baseScore)
  pushSuggestion(bucket, 'Asesoria inmobiliaria', 'El contexto sugiere acompanamiento o asesoria inmobiliaria.', 108 + baseScore)
}

function addEducationSuggestions(text, bucket) {
  const baseScore = scoreKeywords(text, ['curso', 'cursos', 'academia', 'clases', 'diplomado', 'capacitacion', 'formacion', 'certificacion'])
  if (!baseScore) return
  pushSuggestion(bucket, 'Cursos y capacitaciones', 'El pre-prompt apunta a educacion o formacion.', 118 + baseScore)
  pushSuggestion(bucket, 'Clases personalizadas', 'La oferta puede convertirse en clases o acompanamiento.', 110 + baseScore)
  if (scoreKeywords(text, ['diplomado', 'certificacion', 'programa']) > 0) pushSuggestion(bucket, 'Diplomados y certificaciones', 'Detecte programas o certificaciones.', 108 + baseScore)
}

function addHealthSuggestions(text, bucket) {
  const baseScore = scoreKeywords(text, ['medico', 'salud', 'clinica', 'consulta', 'especialista', 'terapia', 'psicologia', 'bienestar'])
  if (!baseScore) return
  pushSuggestion(bucket, 'Consulta especializada', 'El pre-prompt habla de salud, consultas o especialistas.', 118 + baseScore)
  pushSuggestion(bucket, 'Agenda de citas medicas', 'La campana parece buscar pacientes o reservas.', 110 + baseScore)
  if (scoreKeywords(text, ['bienestar', 'terapia', 'psicologia']) > 0) pushSuggestion(bucket, 'Servicios de bienestar', 'El contexto encaja con bienestar o acompanamiento terapeutico.', 108 + baseScore)
}

function addComputersSuggestions(text, bucket) {
  const baseScore = scoreKeywords(text, ['computador', 'computadores', 'laptop', 'portatil', 'portatiles', 'impresora'])
  if (!baseScore) return
  pushSuggestion(bucket, 'Venta de computadores', 'Detecte una oferta relacionada con computadores o portatiles.', 118 + baseScore)
  pushSuggestion(bucket, 'Accesorios de computo', 'El servicio puede orientarse a perifericos o accesorios.', 108 + scoreKeywords(text, ['accesorio', 'accesorios', 'mouse', 'teclado', 'monitor']))
  if (scoreKeywords(text, ['mantenimiento', 'reparacion', 'soporte']) > 0) pushSuggestion(bucket, 'Soporte y mantenimiento', 'El contexto habla de reparacion o soporte tecnico.', 112 + baseScore)
}

function deriveFallbackSuggestions(prePrompt, bucket) {
  const serviceText = String(prePrompt || '')
  const compact = titleCase(
    serviceText
      .replace(/\b(en|para|con|por|desde|bogota|medellin|cali|barranquilla|cartagena|colombia)\b.*$/i, '')
      .replace(/[^\w\sñáéíóú-]/gi, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2)
      .slice(0, 5)
      .join(' ')
  )

  if (compact) {
    pushSuggestion(bucket, compact, 'Use una lectura resumida del pre-prompt para proponer el servicio central.', 98)
    pushSuggestion(bucket, `Promocion de ${compact}`, 'Genere una segunda variante util para campanas de servicio local.', 96)
    pushSuggestion(bucket, `Oferta de ${compact}`, 'Mantengo una alternativa clara cuando el nicho no coincide con una categoria conocida.', 94)
    return
  }

  pushSuggestion(bucket, 'Servicio principal', 'No encontre una categoria clara, pero mantuve una propuesta base para continuar.', 92)
}

function analyzePrePromptServices(prePrompt = '') {
  const text = normalize(prePrompt)
  if (!text.trim()) {
    return { suggestions: [] }
  }

  const bucket = new Map()
  addSoftwareSuggestions(text, bucket)
  addVeterinarySuggestions(text, bucket)
  addGamingSuggestions(text, bucket)
  addAutomotiveSuggestions(text, bucket)
  addBeautySuggestions(text, bucket)
  addDentalSuggestions(text, bucket)
  addRealEstateSuggestions(text, bucket)
  addEducationSuggestions(text, bucket)
  addHealthSuggestions(text, bucket)
  addComputersSuggestions(text, bucket)

  if (bucket.size === 0) {
    deriveFallbackSuggestions(prePrompt, bucket)
  }

  return {
    suggestions: [...bucket.values()]
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, 8),
  }
}

module.exports = {
  analyzePrePromptServices,
}
