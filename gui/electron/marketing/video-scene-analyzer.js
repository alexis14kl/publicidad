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
  const stopWords = new Set([
    'estilo', 'pixar', 'disney', 'netflix', 'anime', 'cartoon', 'pelicula', 'serie',
    'presentando', 'presentado', 'inspirado', 'inspirada', 'tipo', 'como', 'para',
  ])
  const compact = String(prompt || '')
    .replace(/[^\w\sáéíóúñ-]/gi, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .filter((word) => !stopWords.has(String(word || '').trim().toLowerCase()))
    .slice(0, 5)
    .join(' ')

  return compact ? titleCase(compact) : fallback
}

function buildMarketingDialogue(focus, index) {
  if (index === 0) {
    return `Ojo con esto: ${focus} puede cambiar la forma en que trabajas hoy.`
  }
  if (index === 1) {
    return 'Mira bien, aqui es donde se nota el cambio de verdad.'
  }
  return 'Es tu momento de dar el siguiente paso.'
}

function buildCharacterDialogue(index, invitationMode = false) {
  if (invitationMode) {
    if (index === 0) return 'Hola, te tengo una invitacion que no te puedes perder.'
    if (index === 1) return 'Va a estar increible, lleno de diversion y sorpresas.'
    return 'No faltes, te espero para celebrar juntos.'
  }

  if (index === 0) return 'Ey, mira esto, que apenas va empezando.'
  if (index === 1) return 'Ahora si se puso buena la historia.'
  return 'Vamos, quedate conmigo hasta el final.'
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

function buildMarketingStylePrompt(focus, sceneGoal, extraDetails = '') {
  return [
    'Commercial AI video style, vertical 9:16, premium ad look.',
    `${focus}.`,
    sceneGoal,
    extraDetails,
    'Fast readability, clean motion, Spanish on-screen text only.',
  ].filter(Boolean).join(' ')
}

function buildCharacterStylePrompt(focus, sceneGoal, extraDetails = '', invitationMode = false) {
  const style = invitationMode
    ? 'Pixar-inspired 3D animation style, bright saturated colors, cel-shaded lighting.'
    : 'Pixar-inspired 3D animation style, bright saturated colors, cel-shaded lighting.'

  return [
    style,
    `${focus}.`,
    sceneGoal,
    extraDetails,
    'Short, clear, expressive shot with strong continuity.',
  ].filter(Boolean).join(' ')
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
      prompt: buildMarketingStylePrompt(
        focus,
        `Strong first-second hook. Show ${focus} with ${category.visual}.`,
        'Close-up hero shot, premium setting.'
      ),
      dialogue: buildMarketingDialogue(focus, 0),
    },
    {
      id: 'scene-2',
      label: 'Escena 02',
      title: 'Valor y Diferencial',
      timeRange: '5s - 10s',
      prompt: buildMarketingStylePrompt(
        focus,
        `Show how ${focus} solves a real need with visible value.`,
        'Subject in action, clear benefit.'
      ),
      dialogue: buildMarketingDialogue(focus, 1),
    },
    {
      id: 'scene-3',
      label: 'Escena 03',
      title: 'Cierre con CTA',
      timeRange: '10s - 15s',
      prompt: buildMarketingStylePrompt(
        focus,
        'Finish with a conversion-focused closing shot and clear CTA.',
        'Front-facing subject, clean closing frame.'
      ),
      dialogue: buildMarketingDialogue(focus, 2),
    },
  ]
}

function buildCharacterScenes(prompt, invitationMode = false) {
  const focus = extractFocus(prompt, invitationMode ? 'la celebracion principal' : 'la historia principal')

  return [
    {
      id: 'scene-1',
      label: 'Escena 01',
      title: invitationMode ? 'Apertura del Evento' : 'Apertura del Personaje',
      timeRange: '0s - 5s',
      prompt: buildCharacterStylePrompt(
        focus,
        `Strong opening shot. ${focus} centered, expressive, dynamic.`,
        'Hero framing, recognizable animated setting.',
        invitationMode
      ),
      dialogue: buildCharacterDialogue(0, invitationMode),
    },
    {
      id: 'scene-2',
      label: 'Escena 02',
      title: invitationMode ? 'Momento de Invitacion' : 'Desarrollo de la Escena',
      timeRange: '5s - 10s',
      prompt: buildCharacterStylePrompt(
        focus,
        'Show the main action with strong continuity and exaggerated gestures.',
        'Clear action beat, lively motion.',
        invitationMode
      ),
      dialogue: buildCharacterDialogue(1, invitationMode),
    },
    {
      id: 'scene-3',
      label: 'Escena 03',
      title: invitationMode ? 'Cierre y Confirmacion' : 'Cierre de Impacto',
      timeRange: '10s - 15s',
      prompt: buildCharacterStylePrompt(
        focus,
        'Create a memorable ending with strong final expression and clean closing message.',
        'Clean final pose, conclusive shot.',
        invitationMode
      ),
      dialogue: buildCharacterDialogue(2, invitationMode),
    },
  ]
}

function compileScenesForBot(prompt, scenes) {
  return [
    'Usa el enfoque del agente video-scene-creator para producir un video coherente de 3 escenas.',
    `Prompt base del usuario: ${prompt}`,
    'Mantener continuidad visual entre escenas. Los prompts visuales deben quedar en ingles profesional para video AI. El voiceover debe quedar en español natural.',
    ...scenes.map((scene) =>
      `${scene.label} - ${scene.title} (${scene.timeRange})\nPrompt: ${scene.prompt}\nVoiceover (español): "${scene.dialogue}"`
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
        ? 'El agente estructuro una apertura, una escena de valor y un cierre con CTA con prompts visuales tipo video AI y voiceover en español.'
        : 'El agente estructuro tres escenas con prompts visuales tipo video AI y voiceover listo en español.',
    scenes,
    compiledPrompt: compileScenesForBot(prompt, scenes),
  }
}

module.exports = {
  analyzeVideoScenes,
}
