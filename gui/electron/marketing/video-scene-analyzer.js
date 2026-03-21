const path = require('path')
const { PROJECT_ROOT } = require('../config/project-paths')
const { normalizeUiText } = require('../utils/helpers')

const AGENT_SOURCE_PATH = path.join(PROJECT_ROOT, 'utils', 'AgenteMarketing', 'video-scene-creator.md')

function normalize(value = '') {
  return normalizeUiText(String(value || ''))
}

function titleCase(value = '') {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function scoreKeywords(text, keywords = []) {
  return keywords.reduce((total, keyword) => total + (text.includes(normalize(keyword)) ? 1 : 0), 0)
}

function extractFocus(prompt = '', fallback = 'la oferta principal') {
  const compact = String(prompt || '')
    .replace(/[^\w\sáéíóúñ-]/gi, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 7)
    .join(' ')

  return compact ? titleCase(compact) : fallback
}

function detectVideoMode(text) {
  if (scoreKeywords(text, ['cumple', 'cumpleanos', 'cumpleaños', 'fiesta', 'invitacion', 'party']) > 0) {
    return 'invitation'
  }
  if (scoreKeywords(text, ['pelicula', 'serie', 'personaje', 'disney', 'pixar', 'netflix', 'anime', 'cartoon']) > 0) {
    return 'character'
  }
  return 'marketing'
}

function detectCategory(text) {
  const categories = [
    {
      key: 'software',
      score: scoreKeywords(text, ['software', 'desarrollo', 'automatizacion', 'rpa', 'erp', 'crm', 'app', 'aplicacion']),
      visual: 'interfaces limpias, paneles modernos, automatizaciones visibles, ritmo agil',
      cta: 'agenda una demo o escribe por asesoría',
    },
    {
      key: 'veterinaria',
      score: scoreKeywords(text, ['veterinaria', 'mascota', 'perro', 'gato', 'peluqueria', 'pet']),
      visual: 'mascotas felices, entorno limpio, productos y atencion cercana',
      cta: 'reserva tu cita o pide informacion ahora',
    },
    {
      key: 'automotriz',
      score: scoreKeywords(text, ['carro', 'auto', 'vehiculo', 'moto', 'concesionario']),
      visual: 'tomas dinamicas del vehiculo, detalles premium, sensacion de confianza',
      cta: 'cotiza, agenda visita o solicita financiacion',
    },
    {
      key: 'gaming',
      score: scoreKeywords(text, ['videojuego', 'gaming', 'gamer', 'consola', 'xbox', 'playstation', 'nintendo']),
      visual: 'energia alta, luces vibrantes, producto protagonista, ritmo rapido',
      cta: 'compra, aparta o escribe para disponibilidad',
    },
    {
      key: 'general',
      score: 1,
      visual: 'producto o servicio protagonista, composicion limpia y enfoque comercial',
      cta: 'escribe ahora para recibir informacion',
    },
  ]

  return categories.sort((a, b) => b.score - a.score)[0]
}

function buildMarketingScenes(prompt) {
  const normalized = normalize(prompt)
  const focus = extractFocus(prompt)
  const category = detectCategory(normalized)

  return [
    {
      id: 'scene-1',
      label: 'Escena 01',
      title: 'Hook Comercial',
      timeRange: '0s - 5s',
      prompt: `Commercial AI video style, vertical 9:16, high clarity, strong hook in the first second. Mostrar ${focus} con ${category.visual}. Abrir con un problema o deseo claro del cliente ideal, texto corto y legible, composicion enfocada en conversion.`,
      dialogue: `Si buscas ${focus}, aqui empieza una opcion clara y facil de entender.`,
    },
    {
      id: 'scene-2',
      label: 'Escena 02',
      title: 'Valor y Diferencial',
      timeRange: '5s - 10s',
      prompt: `Maintain the same visual identity and subject continuity. Mostrar como ${focus} resuelve una necesidad real, incluir prueba visual del beneficio, transicion suave, enfoque en confianza, claridad y resultado esperado.`,
      dialogue: `Te mostramos por que esta opcion te ahorra tiempo y te ayuda a decidir mejor.`,
    },
    {
      id: 'scene-3',
      label: 'Escena 03',
      title: 'Cierre con CTA',
      timeRange: '10s - 15s',
      prompt: `Final conversion scene, same style and continuity. Cerrar con ${focus} en primer plano, mensaje directo, CTA visible y lectura rapida. Mantener energia comercial y dejar claro el siguiente paso.`,
      dialogue: `Da el siguiente paso hoy y ${category.cta}.`,
    },
  ]
}

function buildCharacterScenes(prompt, invitationMode = false) {
  const focus = extractFocus(prompt, invitationMode ? 'la celebracion principal' : 'la historia principal')
  const stylePrefix = invitationMode
    ? 'Animated 3D cartoon style, bright saturated colors, cel-shaded lighting, energetic party mood.'
    : 'Animated 3D cartoon style inspired by an animated movie or series, bright saturated colors, cel-shaded lighting.'

  return [
    {
      id: 'scene-1',
      label: 'Escena 01',
      title: invitationMode ? 'Apertura del Evento' : 'Apertura del Personaje',
      timeRange: '0s - 5s',
      prompt: `${stylePrefix} Introducir ${focus} con una apertura visual fuerte, personaje o protagonista al centro, texto en pantalla legible y movimiento dinamico.`,
      dialogue: invitationMode
        ? `Ya casi llega ${focus} y va a estar increible.`
        : `Aqui empieza ${focus} con toda la energia del personaje principal.`,
    },
    {
      id: 'scene-2',
      label: 'Escena 02',
      title: invitationMode ? 'Momento de Invitacion' : 'Desarrollo de la Escena',
      timeRange: '5s - 10s',
      prompt: `${stylePrefix} Mantener continuidad visual del protagonista. Mostrar accion central, elementos iconicos del universo visual y mensaje corto que conecte con ${focus}.`,
      dialogue: invitationMode
        ? 'Preparate para una escena divertida, llena de color y mucha emocion.'
        : `Todo gira alrededor de ${focus} y se siente desde esta escena.`,
    },
    {
      id: 'scene-3',
      label: 'Escena 03',
      title: invitationMode ? 'Cierre y Confirmacion' : 'Cierre de Impacto',
      timeRange: '10s - 15s',
      prompt: `${stylePrefix} Cierre memorable con el protagonista, mensaje final grande y legible, composicion limpia para CTA y continuidad del estilo de animacion.`,
      dialogue: invitationMode
        ? 'No faltes, confirma y ven a vivir esta celebracion.'
        : 'Cierra con fuerza y deja claro que esta historia merece verse completa.',
    },
  ]
}

function compileScenesForBot(prompt, scenes) {
  return [
    'Usa el enfoque del agente video-scene-creator para producir un video coherente de 3 escenas.',
    `Prompt base del usuario: ${prompt}`,
    'Mantener continuidad visual, texto legible, energia comercial y dialogos naturales en espanol.',
    ...scenes.map((scene) =>
      `${scene.label} - ${scene.title} (${scene.timeRange})\nPrompt: ${scene.prompt}\nDialogue (espanol): "${scene.dialogue}"`
    ),
  ].join('\n\n')
}

function analyzeVideoScenes(prePrompt = '') {
  const prompt = String(prePrompt || '').trim()
  if (!prompt) {
    return {
      agentName: 'video-scene-creator',
      sourcePath: AGENT_SOURCE_PATH,
      summary: 'Escribe un prompt para generar tres escenas antes de enviar el video al bot.',
      scenes: [],
      compiledPrompt: '',
    }
  }

  const normalized = normalize(prompt)
  const mode = detectVideoMode(normalized)
  const scenes = mode === 'marketing'
    ? buildMarketingScenes(prompt)
    : buildCharacterScenes(prompt, mode === 'invitation')

  return {
    agentName: 'video-scene-creator',
    sourcePath: AGENT_SOURCE_PATH,
    summary:
      mode === 'marketing'
        ? 'El agente estructuro una apertura, una escena de valor y un cierre con CTA para el video.'
        : 'El agente estructuro tres escenas con continuidad visual y dialogos listos para video AI.',
    scenes,
    compiledPrompt: compileScenesForBot(prompt, scenes),
  }
}

module.exports = {
  analyzeVideoScenes,
}
