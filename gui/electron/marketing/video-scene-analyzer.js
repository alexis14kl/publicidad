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

function includesAny(text, keywords = []) {
  return scoreKeywords(text, keywords) > 0
}

function extractFocus(prompt = '', fallback = 'la oferta principal') {
  const stopWords = new Set([
    'estilo', 'pixar', 'disney', 'netflix', 'anime', 'cartoon', 'pelicula', 'serie',
    'presentando', 'presentado', 'inspirado', 'inspirada', 'tipo', 'como', 'para',
    'video', 'videos', 'escena', 'escenas', 'segundos', 'segundo',
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

function toPromptSubject(value = '') {
  return String(value || '')
    .replace(/\bcapibara\b/gi, 'capybara')
    .replace(/\bdesarrolladora\b/gi, 'developer')
    .replace(/\bdesarrollador\b/gi, 'developer')
    .replace(/\bprogramadora\b/gi, 'developer')
    .replace(/\bprogramador\b/gi, 'developer')
    .replace(/\bingeniera\b/gi, 'engineer')
    .replace(/\bingeniero\b/gi, 'engineer')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSceneTimeRange(index) {
  const start = index * 7
  const end = start + 7
  return `${start}s - ${end}s`
}

function detectTechnicalTheme(text) {
  if (includesAny(text, ['merge', 'conflict', 'conflicto', 'branch', 'rama', 'git'])) {
    return 'merge_conflict'
  }
  if (includesAny(text, ['login', 'auth', 'autenticacion', 'autenticación', 'token', 'password', 'contrasena', 'contraseña', 'security', 'seguridad'])) {
    return 'auth_bug'
  }
  if (includesAny(text, ['deploy', 'release', 'rollback', 'production', 'produccion', 'producción', 'staging'])) {
    return 'deploy'
  }
  if (includesAny(text, ['bug', 'error', 'fallo', 'fix', 'hotfix', 'debug'])) {
    return 'debug'
  }
  return 'technical_general'
}

function detectVideoMode(text) {
  if (includesAny(text, ['cumple', 'cumpleanos', 'cumpleaños', 'fiesta', 'invitacion', 'invitación', 'party'])) {
    return 'invitation'
  }
  if (includesAny(text, ['software', 'desarrollo', 'desarrollador', 'desarrolladora', 'programador', 'programadora', 'login', 'auth', 'deploy', 'merge', 'bug', 'token', 'codigo', 'código', 'git', 'backend', 'frontend', 'api', 'base de datos'])) {
    return 'technical'
  }
  if (includesAny(text, ['campana', 'campaña', 'servicio', 'producto', 'vender', 'ventas', 'marca', 'cliente', 'negocio', 'empresa', 'publicidad', 'promocion', 'promoción'])) {
    return 'marketing'
  }
  if (includesAny(text, ['pelicula', 'película', 'serie', 'personaje', 'disney', 'pixar', 'netflix', 'anime', 'cartoon'])) {
    return 'character'
  }
  return 'story'
}

function detectCategory(text) {
  const categories = [
    {
      key: 'software',
      score: scoreKeywords(text, ['software', 'desarrollo', 'automatizacion', 'rpa', 'erp', 'crm', 'app', 'aplicacion', 'login', 'auth', 'token', 'merge', 'deploy', 'git']),
      visual: 'clean code on screen, product interfaces, visible technical tension',
      cta: 'escribe para implementar una solucion mas segura y profesional',
    },
    {
      key: 'veterinaria',
      score: scoreKeywords(text, ['veterinaria', 'mascota', 'perro', 'gato', 'peluqueria', 'pet']),
      visual: 'happy pets, clean clinic details, caring human interaction',
      cta: 'reserva tu cita o pide informacion ahora',
    },
    {
      key: 'automotriz',
      score: scoreKeywords(text, ['carro', 'auto', 'vehiculo', 'moto', 'concesionario']),
      visual: 'dynamic car shots, premium details, high trust purchase context',
      cta: 'cotiza, agenda visita o solicita financiacion',
    },
    {
      key: 'gaming',
      score: scoreKeywords(text, ['videojuego', 'gaming', 'gamer', 'consola', 'xbox', 'playstation', 'nintendo']),
      visual: 'high energy action, vibrant lights, clear product focus',
      cta: 'compra, aparta o escribe para disponibilidad',
    },
    {
      key: 'general',
      score: 1,
      visual: 'clear hero action, strong subject focus, readable visual hierarchy',
      cta: 'escribe ahora para recibir informacion',
    },
  ]

  return categories.sort((a, b) => b.score - a.score)[0]
}

function buildMarketingDialogue(focus, index, category) {
  if (index === 0) {
    return `El problema aparece rapido. ${focus} necesita una solucion clara de inmediato.`
  }
  if (index === 1) {
    return `Aqui se nota el cambio: ${focus} empieza a resolver una necesidad real.`
  }
  return `Si quieres este resultado, ${category.cta}.`
}

function buildInvitationDialogue(focus, index) {
  if (index === 0) return `${focus} tiene algo importante que anunciar.`
  if (index === 1) return 'La fecha ya esta lista. Y la celebracion promete muchisimo.'
  return 'Solo falta una cosa: que no faltes.'
}

function buildTechnicalDialogue(focus, theme, index) {
  if (theme === 'merge_conflict') {
    if (index === 0) return 'Dos cambios. Un mismo archivo. Y cero coordinacion.'
    if (index === 1) return 'Algo fallo. Llego el fix rapido. Y nadie reviso lo que entraba.'
    return 'Cuando hicieron merge, el desastre ya estaba sembrado.'
  }

  if (theme === 'auth_bug') {
    if (index === 0) return 'Todo dependia del login. Y justo ahi empezo el problema.'
    if (index === 1) return 'Para salir del paso, alguien metio una solucion demasiado peligrosa.'
    return 'Funciono un momento. Despues, se volvio un riesgo real.'
  }

  if (theme === 'deploy') {
    if (index === 0) return 'Viernes, deploy y demasiada confianza. Mala combinacion.'
    if (index === 1) return 'Se saltaron una revision. Production lo sintio al instante.'
    return 'El release salio. La crisis tambien.'
  }

  if (theme === 'debug') {
    if (index === 0) return 'Parecia un error pequeno. No lo era.'
    if (index === 1) return 'Lo arreglaron rapido. Demasiado rapido.'
    return 'La solucion corta termino costando mas.'
  }

  if (index === 0) return `${focus} arranca tranquilo. El problema todavia no se nota.`
  if (index === 1) return 'Algo se rompe. Y aparece la peor solucion posible.'
  return 'Lo temporal dura segundos. Las consecuencias, mucho mas.'
}

function buildCharacterDialogue(focus, index) {
  if (index === 0) return `${focus} entra en escena. Todo parece bajo control.`
  if (index === 1) return 'Entonces aparece el giro. Y ya no hay vuelta atras.'
  return 'Lo que empieza tranquilo termina con un cierre fuerte.'
}

function buildMarketingStylePrompt(focus, sceneGoal, extraDetails = '') {
  return [
    'Commercial AI video style, vertical 9:16, premium ad look.',
    `${toPromptSubject(focus)}.`,
    sceneGoal,
    extraDetails,
    'Fast readability, clean motion, Spanish on-screen text only.',
  ].filter(Boolean).join(' ')
}

function buildCharacterStylePrompt(style, focus, sceneGoal, extraDetails = '') {
  return [
    style,
    `${toPromptSubject(focus)}.`,
    sceneGoal,
    extraDetails,
    'Short, clear, expressive shot with strong continuity.',
  ].filter(Boolean).join(' ')
}

function resolveCharacterStyle(text, mode) {
  if (includesAny(text, ['anime'])) {
    return 'Stylized anime cinematic animation, bold colors, expressive lighting.'
  }
  if (includesAny(text, ['disney', 'pixar', 'cartoon']) || mode === 'technical' || mode === 'story' || mode === 'invitation') {
    return 'Pixar-inspired 3D animation style, bright saturated colors, cel-shaded lighting.'
  }
  return 'Stylized animated movie look, bright colors, expressive cinematic lighting.'
}

function buildTechnicalScenes(prompt) {
  const normalized = normalize(prompt)
  const theme = detectTechnicalTheme(normalized)
  const focus = extractFocus(prompt, 'capybara developer')
  const style = resolveCharacterStyle(normalized, 'technical')

  const sceneSpecs = {
    merge_conflict: [
      {
        title: 'EL PLAN INOCENTE',
        goal: `Same ${toPromptSubject(focus)} working confidently on a shared critical file, unaware of the coordination problem already building up.`,
        extra: 'Wide shot, same office, same workstation, productive lighting, clear file on monitor.',
      },
      {
        title: 'EL FIX PELIGROSO',
        goal: `A visible failure appears on screen and the same ${toPromptSubject(focus)} applies a rushed fix without reviewing the full impact.`,
        extra: 'Close-up on monitor and tense face, red error state, nervous late-office energy.',
      },
      {
        title: 'EL DESASTRE APARECE',
        goal: `The consequence finally becomes visible as conflicts, broken logic or system chaos spread across the same project.`,
        extra: 'Medium dramatic shot, visible fallout on screen, stronger tension in the room.',
      },
    ],
    auth_bug: [
      {
        title: 'EL LOGIN EMPIEZA A FALLAR',
        goal: `Same ${toPromptSubject(focus)} in a modern dev office staring at a broken login or authentication flow that suddenly stops working.`,
        extra: 'Over-the-shoulder shot, red error on screen, office still looks calm but tension starts.',
      },
      {
        title: 'LA SOLUCION RAPIDA',
        goal: `Under pressure, the same ${toPromptSubject(focus)} hardcodes a risky workaround into the login logic just to make the error disappear.`,
        extra: 'Close-up on monitor, dangerous line highlighted, anxious face, sneaky dim office lighting.',
      },
      {
        title: 'EL RIESGO YA ESTA ADENTRO',
        goal: `The insecure fix now shows visible consequences as the system looks exposed, unstable or ready to fail in production.`,
        extra: 'Medium shot with warning indicators, tense team atmosphere, dramatic office lighting.',
      },
    ],
    deploy: [
      {
        title: 'TODO PARECIA LISTO',
        goal: `Same ${toPromptSubject(focus)} preparing a Friday release with green dashboards and visible confidence.`,
        extra: 'Wide startup office shot, deployment checklist visible, warm productive lighting.',
      },
      {
        title: 'LA REVISION QUE FALTO',
        goal: `The same ${toPromptSubject(focus)} skips a key validation step and launches the deploy while alerts begin to appear.`,
        extra: 'Close-up on deploy action and missing checklist item, tension rising on screens.',
      },
      {
        title: 'PRODUCTION LO SIENTE',
        goal: `The release fallout becomes visible as dashboards turn red and the office reacts to the incident in real time.`,
        extra: 'Medium dramatic shot, warning lights on screens, rollback or panic visible in the room.',
      },
    ],
    debug: [
      {
        title: 'PARECIA UN BUG MENOR',
        goal: `Same ${toPromptSubject(focus)} notices a technical issue on screen that initially looks small and manageable.`,
        extra: 'Clean office environment, error visible but not catastrophic yet, controlled lighting.',
      },
      {
        title: 'EL ARREGLO APRESURADO',
        goal: `Trying to move fast, the same ${toPromptSubject(focus)} applies a rushed fix without checking hidden side effects.`,
        extra: 'Close-up on keyboard and code, visible urgency, tense focused expression.',
      },
      {
        title: 'LA CONSECUENCIA',
        goal: `The quick fix causes a bigger visible problem, forcing the same ${toPromptSubject(focus)} to face the fallout.`,
        extra: 'Medium shot, error spread on screen, office tension now obvious.',
      },
    ],
    technical_general: [
      {
        title: 'TODO BAJO CONTROL',
        goal: `Same ${toPromptSubject(focus)} starts calmly in a modern technical workspace, with the real problem still hidden.`,
        extra: 'Wide hero shot, readable monitor, controlled office environment.',
      },
      {
        title: 'LA PEOR DECISION',
        goal: `A clear technical failure appears and the same ${toPromptSubject(focus)} chooses a rushed shortcut to get past it.`,
        extra: 'Close-up on screen and face, visible mistake happening now, stronger tension.',
      },
      {
        title: 'EL PROBLEMA CRECE',
        goal: `That shortcut now reveals visible consequences around the same workspace, team or system.`,
        extra: 'Medium dramatic shot, fallout on monitor, tension spreading through the scene.',
      },
    ],
  }

  return (sceneSpecs[theme] || sceneSpecs.technical_general).map((scene, index) => ({
    id: `scene-${index + 1}`,
    label: `Escena 0${index + 1}`,
    title: scene.title,
    timeRange: buildSceneTimeRange(index),
    prompt: buildCharacterStylePrompt(style, focus, scene.goal, scene.extra),
    dialogue: buildTechnicalDialogue(focus, theme, index),
  }))
}

function buildMarketingScenes(prompt) {
  const normalized = normalize(prompt)
  const focus = extractFocus(prompt)
  const category = detectCategory(normalized)

  return [
    {
      id: 'scene-1',
      label: 'Escena 01',
      title: 'EL PROBLEMA SE VE',
      timeRange: buildSceneTimeRange(0),
      prompt: buildMarketingStylePrompt(
        focus,
        `Strong first-second hook. Show the visible problem around ${toPromptSubject(focus)} with ${category.visual}.`,
        'Close-up hero shot, premium setting, immediate pain point visible.'
      ),
      dialogue: buildMarketingDialogue(focus, 0, category),
    },
    {
      id: 'scene-2',
      label: 'Escena 02',
      title: 'LA SOLUCION EN ACCION',
      timeRange: buildSceneTimeRange(1),
      prompt: buildMarketingStylePrompt(
        focus,
        `Show how ${toPromptSubject(focus)} solves a real need with visible value and a stronger sense of relief.`,
        'Subject in action, clear before-and-after feeling, readable benefit.'
      ),
      dialogue: buildMarketingDialogue(focus, 1, category),
    },
    {
      id: 'scene-3',
      label: 'Escena 03',
      title: 'EL CIERRE CON CTA',
      timeRange: buildSceneTimeRange(2),
      prompt: buildMarketingStylePrompt(
        focus,
        'Finish with a conversion-focused closing shot and a clear call to action.',
        'Front-facing subject, clean closing frame, premium ad ending.'
      ),
      dialogue: buildMarketingDialogue(focus, 2, category),
    },
  ]
}

function buildInvitationScenes(prompt) {
  const normalized = normalize(prompt)
  const focus = extractFocus(prompt, 'la celebracion principal')
  const style = resolveCharacterStyle(normalized, 'invitation')

  return [
    {
      id: 'scene-1',
      label: 'Escena 01',
      title: 'EL ANUNCIO',
      timeRange: buildSceneTimeRange(0),
      prompt: buildCharacterStylePrompt(
        style,
        focus,
        `Same ${toPromptSubject(focus)} opening the invitation moment with excitement and a clear celebratory reveal.`,
        'Hero framing, bright party energy, readable visual focus.'
      ),
      dialogue: buildInvitationDialogue(focus, 0),
    },
    {
      id: 'scene-2',
      label: 'Escena 02',
      title: 'LA FIESTA TOMA FORMA',
      timeRange: buildSceneTimeRange(1),
      prompt: buildCharacterStylePrompt(
        style,
        focus,
        `Show the celebration details building up with strong continuity, movement and joyful event energy.`,
        'Clear action beat, festive motion, colorful environment details.'
      ),
      dialogue: buildInvitationDialogue(focus, 1),
    },
    {
      id: 'scene-3',
      label: 'Escena 03',
      title: 'EL CIERRE',
      timeRange: buildSceneTimeRange(2),
      prompt: buildCharacterStylePrompt(
        style,
        focus,
        'Create a memorable ending with a strong celebratory pose and a direct invitation to attend.',
        'Clean final pose, readable closing message, upbeat ending.'
      ),
      dialogue: buildInvitationDialogue(focus, 2),
    },
  ]
}

function buildCharacterScenes(prompt) {
  const normalized = normalize(prompt)
  const focus = extractFocus(prompt, 'the main character')
  const style = resolveCharacterStyle(normalized, 'character')

  return [
    {
      id: 'scene-1',
      label: 'Escena 01',
      title: 'LA PRESENTACION',
      timeRange: buildSceneTimeRange(0),
      prompt: buildCharacterStylePrompt(
        style,
        focus,
        `Strong opening shot. Same ${toPromptSubject(focus)} enters the scene with a clear emotional setup and stable visual identity.`,
        'Hero framing, recognizable animated setting, strong continuity anchor.'
      ),
      dialogue: buildCharacterDialogue(focus, 0),
    },
    {
      id: 'scene-2',
      label: 'Escena 02',
      title: 'EL GIRO',
      timeRange: buildSceneTimeRange(1),
      prompt: buildCharacterStylePrompt(
        style,
        focus,
        `The same ${toPromptSubject(focus)} faces a visible turning point or conflict that changes the energy of the scene.`,
        'Clear action beat, expressive movement, strong emotional shift.'
      ),
      dialogue: buildCharacterDialogue(focus, 1),
    },
    {
      id: 'scene-3',
      label: 'Escena 03',
      title: 'EL REMATE',
      timeRange: buildSceneTimeRange(2),
      prompt: buildCharacterStylePrompt(
        style,
        focus,
        `Create a memorable ending where the same ${toPromptSubject(focus)} lands the final emotional or visual payoff.`,
        'Clean final pose, strong expression, visually satisfying ending.'
      ),
      dialogue: buildCharacterDialogue(focus, 2),
    },
  ]
}

function buildStoryScenes(prompt) {
  const normalized = normalize(prompt)
  const focus = extractFocus(prompt, 'the main character')
  const style = resolveCharacterStyle(normalized, 'story')

  return [
    {
      id: 'scene-1',
      label: 'Escena 01',
      title: 'TODO PARECE NORMAL',
      timeRange: buildSceneTimeRange(0),
      prompt: buildCharacterStylePrompt(
        style,
        focus,
        `Same ${toPromptSubject(focus)} in a stable environment where everything still looks under control.`,
        'Wide opening shot, clear setting, visual calm before the change.'
      ),
      dialogue: `${focus} entra tranquilo. El problema todavia no aparece.`,
    },
    {
      id: 'scene-2',
      label: 'Escena 02',
      title: 'ALGO CAMBIA',
      timeRange: buildSceneTimeRange(1),
      prompt: buildCharacterStylePrompt(
        style,
        focus,
        `A visible twist interrupts the calm and forces the same ${toPromptSubject(focus)} to react immediately.`,
        'Closer framing, readable disruption, stronger tension in the scene.'
      ),
      dialogue: 'Entonces algo cambia. Y ya nada se siente tan seguro.',
    },
    {
      id: 'scene-3',
      label: 'Escena 03',
      title: 'EL CIERRE',
      timeRange: buildSceneTimeRange(2),
      prompt: buildCharacterStylePrompt(
        style,
        focus,
        `Finish with a clear consequence, reveal or emotional payoff around the same ${toPromptSubject(focus)}.`,
        'Clean final composition, clear ending beat, strong continuity.'
      ),
      dialogue: 'Lo que parecia simple termina dejando una marca clara.',
    },
  ]
}

function compileScenesForBot(prompt, scenes) {
  return [
    'Usa el enfoque del agente video-scene-creator para producir un video coherente de 3 escenas, 7 segundos por escena.',
    `Prompt base del usuario: ${prompt}`,
    'Mantener continuidad visual entre escenas. Los prompts visuales deben quedar en ingles profesional para video AI. El voiceover debe quedar en español natural, claro y relacionado con la accion visible.',
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
      summary: 'Escribe un prompt para generar tres escenas de 7 segundos antes de enviar el video al bot.',
      scenes: [],
      compiledPrompt: '',
    }
  }

  const normalized = normalize(prompt)
  const mode = detectVideoMode(normalized)
  let scenes = []
  if (mode === 'technical') scenes = buildTechnicalScenes(prompt)
  else if (mode === 'marketing') scenes = buildMarketingScenes(prompt)
  else if (mode === 'invitation') scenes = buildInvitationScenes(prompt)
  else if (mode === 'character') scenes = buildCharacterScenes(prompt)
  else scenes = buildStoryScenes(prompt)

  return {
    agentName: 'video-scene-creator',
    sourcePath: AGENT_SOURCE_PATH,
    summary:
      mode === 'technical'
        ? 'El agente estructuro tres escenas tecnicas de 7 segundos con continuidad visual y voiceovers mas narrativos.'
        : mode === 'marketing'
          ? 'El agente estructuro un hook, una demostracion de valor y un cierre con CTA en bloques de 7 segundos.'
          : 'El agente estructuro tres escenas de 7 segundos con prompts visuales tipo video AI y voiceovers mas claros en español.',
    scenes,
    compiledPrompt: compileScenesForBot(prompt, scenes),
  }
}

module.exports = {
  analyzeVideoScenes,
}
