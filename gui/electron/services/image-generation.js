const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { PROJECT_ROOT } = require('../config/project-paths')
const { IMAGE_FORMATS } = require('../config/image-formats')
const { readJsonFile } = require('../utils/helpers')
const { findPython } = require('../utils/process')
const { getProjectEnv } = require('../utils/env')
const state = require('../state')
const { buildFullPrompt, lookupCompanyData } = require('../data/lookup')
const { prepareLatestMarketingImageAsset } = require('./image-asset')

const PROMPT_FILE = path.join(PROJECT_ROOT, 'core', 'utils', 'prontm.txt')
const DETECT_PORT_PY = path.join(PROJECT_ROOT, 'core', 'cdp', 'detect_port.py')
const FORCE_CDP_PY = path.join(PROJECT_ROOT, 'core', 'cdp', 'force_cdp.py')
const OPEN_PROFILE_JS = path.join(PROJECT_ROOT, 'core', 'perfil', 'abrir_perfil_dicloak.js')
const PROMPT_AUTOMATION_PY = path.join(PROJECT_ROOT, 'core', 'prompt', 'page_pronmt.py')
const DOWNLOAD_IMAGE_PY = path.join(PROJECT_ROOT, 'core', 'prompt', 'download_generated_image.py')
const OVERLAY_LOGO_PY = path.join(PROJECT_ROOT, 'core', 'utils', 'overlay_logo.py')
const BOT_LOCK_FILE = path.join(PROJECT_ROOT, '.bot_runner.lock')
const DEFAULT_MAIN_CDP_PORT = 9333
const DEFAULT_PROFILE_CDP_PORT = 9225
const DEFAULT_PROFILE_NAME = '#1 Chat Gpt PRO'

function emit(onLog, line) {
  if (typeof onLog === 'function') onLog(line)
}

function isBotBusy() {
  if (state.botProcess && state.botProcess.exitCode === null) {
    return 'El bot principal ya esta ejecutando otra automatizacion.'
  }

  const lock = readJsonFile(BOT_LOCK_FILE)
  if (lock && lock.pid) {
    return `El bot principal esta ocupado (pid ${lock.pid}).`
  }

  return ''
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getNodeBinary() {
  const candidates = [
    process.execPath,
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    'node',
  ]

  return candidates.find((candidate) => {
    if (!candidate) return false
    if (candidate === 'node') return true
    return fs.existsSync(candidate) && path.basename(candidate).toLowerCase().includes('node')
  }) || 'node'
}

function getDicloakExecutable() {
  const home = process.env.HOME || ''
  const candidates = process.platform === 'darwin'
    ? [
      '/Applications/DICloak.app/Contents/MacOS/DICloak',
      path.join(home, 'Applications', 'DICloak.app', 'Contents', 'MacOS', 'DICloak'),
    ]
    : process.platform === 'win32'
      ? [
        'C:\\Program Files\\DICloak\\DICloak.exe',
        'C:\\Program Files (x86)\\DICloak\\DICloak.exe',
      ]
      : [
        '/opt/DICloak/dicloak',
        path.join(home, '.local', 'bin', 'dicloak'),
      ]

  return candidates.find((candidate) => fs.existsSync(candidate)) || ''
}

function canUseCdpOnPort(port) {
  return new Promise((resolve) => {
    const url = `http://127.0.0.1:${port}/json/version`
    const req = require('http').get(url, (res) => {
      let body = ''
      res.on('data', (chunk) => {
        body += String(chunk || '')
      })
      res.on('end', () => {
        resolve(res.statusCode >= 200 && res.statusCode < 300 && body.includes('webSocketDebuggerUrl'))
      })
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2500, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForCdpPort(port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await canUseCdpOnPort(port)) return true
    await wait(1000)
  }
  return false
}

function runPythonScript(pythonBin, scriptPath, args = [], env = {}, onLog, prefix) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [scriptPath, ...args], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...env,
        PYTHONPATH: PROJECT_ROOT,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      const text = String(chunk || '')
      stdout += text
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) emit(onLog, `${prefix} ${trimmed}`)
      }
    })

    child.stderr.on('data', (chunk) => {
      const text = String(chunk || '')
      stderr += text
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) emit(onLog, `${prefix} ${trimmed}`)
      }
    })

    child.on('error', reject)
    child.on('close', (code) => resolve({ code: Number(code || 0), stdout, stderr }))
  })
}

function runBinary(binary, args = [], env = {}, onLog, prefix) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: PROJECT_ROOT,
      env: {
        ...getProjectEnv(),
        ...env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      const text = String(chunk || '')
      stdout += text
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) emit(onLog, `${prefix} ${trimmed}`)
      }
    })

    child.stderr.on('data', (chunk) => {
      const text = String(chunk || '')
      stderr += text
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) emit(onLog, `${prefix} ${trimmed}`)
      }
    })

    child.on('error', reject)
    child.on('close', (code) => resolve({ code: Number(code || 0), stdout, stderr }))
  })
}

async function startDicloakMainDebug(onLog) {
  if (await waitForCdpPort(DEFAULT_MAIN_CDP_PORT, 2500)) {
    emit(onLog, `[IMAGE-AUTO][DICLOAK] DICloak ya responde en ${DEFAULT_MAIN_CDP_PORT}.`)
    return
  }

  const executable = getDicloakExecutable()
  if (!executable) {
    throw new Error('No encontre DICloak instalado para abrir el perfil de generacion.')
  }

  emit(onLog, '[IMAGE-AUTO][DICLOAK] Iniciando DICloak en modo debug...')
  const child = spawn(executable, ['--remote-debugging-port=9333', '--remote-allow-origins=*'], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  if (!(await waitForCdpPort(DEFAULT_MAIN_CDP_PORT, 90000))) {
    throw new Error('DICloak no expuso CDP en 9333 despues de iniciarlo.')
  }
}

async function bootstrapProfileCdp(pythonBin, onLog) {
  const env = getProjectEnv()
  const nodeBin = getNodeBinary()
  const profileName = String(env.INITIAL_PROFILE || DEFAULT_PROFILE_NAME).trim() || DEFAULT_PROFILE_NAME

  await startDicloakMainDebug(onLog)

  await runPythonScript(
    pythonBin,
    FORCE_CDP_PY,
    ['--inject-only', '--dicloak-port', String(DEFAULT_MAIN_CDP_PORT)],
    env,
    onLog,
    '[IMAGE-AUTO][HOOK]'
  ).catch(() => null)

  emit(onLog, `[IMAGE-AUTO][PROFILE] Abriendo perfil ${profileName}...`)
  const openResult = await runBinary(
    nodeBin,
    [OPEN_PROFILE_JS, profileName, `http://127.0.0.1:${DEFAULT_MAIN_CDP_PORT}`],
    env,
    onLog,
    '[IMAGE-AUTO][PROFILE]'
  )

  if (openResult.code !== 0) {
    throw new Error(`No pude abrir el perfil de DICloak para generar la imagen.`)
  }

  emit(onLog, '[IMAGE-AUTO][PROFILE] Esperando hidratacion del perfil...')
  await wait(20000)

  emit(onLog, '[IMAGE-AUTO][CDP] Forzando CDP del perfil...')
  const forceResult = await runPythonScript(
    pythonBin,
    FORCE_CDP_PY,
    [
      '--preferred-port', String(DEFAULT_PROFILE_CDP_PORT),
      '--timeout', '45',
      '--dicloak-port', String(DEFAULT_MAIN_CDP_PORT),
    ],
    env,
    onLog,
    '[IMAGE-AUTO][FORCE-CDP]'
  )

  if (forceResult.code !== 0) {
    throw new Error('No pude forzar el CDP del perfil despues de abrirlo.')
  }
}

async function detectProfileCdpPort(pythonBin, onLog, allowBootstrap = true) {
  const result = await runPythonScript(
    pythonBin,
    DETECT_PORT_PY,
    ['--timeout', allowBootstrap ? '12' : '20'],
    {},
    onLog,
    '[IMAGE-AUTO][CDP]'
  )

  if (result.code !== 0 && allowBootstrap) {
    emit(onLog, '[IMAGE-AUTO][CDP] No hay CDP activo. Intentare abrir DICloak y el perfil automaticamente...')
    await bootstrapProfileCdp(pythonBin, onLog)
    return detectProfileCdpPort(pythonBin, onLog, false)
  }

  if (result.code !== 0) {
    throw new Error('No encontre un puerto CDP activo del perfil para generar la imagen.')
  }

  const match = String(result.stdout || '').match(/DEBUG_PORT=(\d{2,5})/)
  const port = match ? Number(match[1]) : 0
  if (!port) {
    throw new Error('No pude resolver el puerto CDP activo del perfil.')
  }
  return port
}

function buildMarketingImagePrompt(preview, orchestrator, imageFormat) {
  const adsAnalyst = orchestrator?.adsAnalyst || {}
  const imageCreator = orchestrator?.imageCreator || {}
  const marketing = orchestrator?.marketing || {}
  const execution = orchestrator?.execution || {}
  const companyName = String(preview?.companyName || getProjectEnv().PUBLICIDAD_COMPANY_NAME || '').trim()
  const company = companyName ? lookupCompanyData(companyName) : null
  const companyContactRules = company
    ? [
      `Empresa seleccionada: ${company.nombre}.`,
      `Telefono oficial para la pieza: ${company.telefono || 'sin telefono'}.`,
      `Sitio web oficial para la pieza: ${company.sitio_web || 'sin sitio web'}.`,
      `Correo oficial: ${company.correo || 'sin correo'}.`,
      `Direccion de referencia: ${company.direccion || 'sin direccion'}.`,
      'El logo real de la empresa se agregara automaticamente despues usando el logo configurado en el formulario de la empresa.',
      'La composicion debe dejar una zona superior limpia y amplia, sin texto ni elementos fuertes, para ubicar el logo sin tapar el contenido principal.',
      'No generes barras superiores ni inferiores con nombre de marca, sitio web, telefono o frases como "contactanos hoy".',
      'El contacto debe quedar integrado visualmente en la pieza original y nunca en una barra extra agregada por el modelo.',
      'No pongas logos, numeros de telefono, sitios web ni CTA pegados al borde superior. Mantener libre al menos el 14% superior.',
    ].join('\n')
    : [
      'Deja una zona superior limpia para ubicar un logo real despues, sin tapar el texto principal.',
      'No generes barras superiores ni inferiores adicionales con branding o contacto.',
      'No pongas texto importante pegado al borde superior. Mantener libre al menos el 14% superior.',
    ].join('\n')
  const userDescription = String(preview?.prePrompt || preview?.campaignIdea || '').trim()
  const basePrompt = [
    `CONCEPTO DE LA CAMPANA: "${userDescription || 'oferta de servicios profesionales'}".`,
    `Esta es una campana de Facebook Ads en ${preview?.city || 'Colombia'}.`,
    `IMPORTANTE: La imagen debe reflejar visualmente "${userDescription}". No generes una escena generica de oficina si el usuario describio algo diferente.`,
    `Objetivo comercial: ${adsAnalyst.objective || 'captacion de clientes potenciales'}.`,
    `Hook principal: ${adsAnalyst.hook || preview?.campaignIdea || 'beneficio principal del servicio'}.`,
    `Copy del anuncio: ${adsAnalyst.copy || marketing.prompt || preview?.marketingPrompt || ''}.`,
    `Ciudad: ${execution.city || preview?.city || 'Colombia'}${Array.isArray(execution.zones) && execution.zones.length > 0 ? `, zonas: ${execution.zones.join(', ')}` : ''}.`,
    `Direccion visual: ${imageCreator.prompt || adsAnalyst.visualReference || 'escena comercial realista y premium'}.`,
    `Genera una sola imagen publicitaria para Meta Ads, mobile-first, realista, profesional, alto contraste y con texto visible en espanol.`,
    `Evita texto pequeno ilegible. Foco en conversion.`,
    companyContactRules,
  ].join('\n')

  return buildFullPrompt(basePrompt, companyName, '', imageFormat || 'fb-horizontal')
}

async function generateMarketingImageAsset({
  preview,
  orchestrator,
  imageFormat = 'fb-horizontal',
  onLog,
}) {
  const busyReason = isBotBusy()
  if (busyReason) {
    return { success: false, status: 'busy', error: busyReason, prompt: '' }
  }

  const pythonBin = findPython()
  if (!pythonBin) {
    return { success: false, status: 'failed', error: 'Python no esta disponible para generar la imagen.', prompt: '' }
  }

  const finalPrompt = buildMarketingImagePrompt(preview, orchestrator, imageFormat)
  if (!finalPrompt.trim()) {
    return { success: false, status: 'failed', error: 'No pude construir un prompt visual valido para la campana.', prompt: '' }
  }

  const promptDir = path.dirname(PROMPT_FILE)
  fs.mkdirSync(promptDir, { recursive: true })
  const promptExisted = fs.existsSync(PROMPT_FILE)
  const previousPrompt = promptExisted ? fs.readFileSync(PROMPT_FILE, 'utf-8') : ''

  const formatConfig = IMAGE_FORMATS[imageFormat] || IMAGE_FORMATS['fb-horizontal']
  const companyName = String(preview?.companyName || getProjectEnv().PUBLICIDAD_COMPANY_NAME || '').trim()
  const company = companyName ? lookupCompanyData(companyName) : null
  const companyLogoPath = String(company?.logo || '').trim()
  const resolvedLogoPath = companyLogoPath
    ? (path.isAbsolute(companyLogoPath) ? companyLogoPath : path.join(PROJECT_ROOT, companyLogoPath))
    : ''
  const hasCompanyLogo = Boolean(resolvedLogoPath && fs.existsSync(resolvedLogoPath))

  if (companyName && !hasCompanyLogo) {
    return {
      success: false,
      status: 'failed',
      error: `La empresa ${companyName} no tiene logo configurado. Agrega el logo en el formulario de la empresa antes de generar la imagen.`,
      prompt: '',
    }
  }

  const env = {
    BOT_IMAGE_WIDTH: String(formatConfig.w),
    BOT_IMAGE_HEIGHT: String(formatConfig.h),
    PUBLICIDAD_COMPANY_NAME: companyName,
    BOT_COMPANY_NAME: String(company?.nombre || ''),
    BOT_COMPANY_PHONE: String(company?.telefono || ''),
    BOT_COMPANY_WEBSITE: String(company?.sitio_web || ''),
    BOT_COMPANY_EMAIL: String(company?.correo || ''),
    BOT_COMPANY_ADDRESS: String(company?.direccion || ''),
    BOT_COMPANY_LOGO_PATH: hasCompanyLogo ? resolvedLogoPath : '',
    BOT_BRAND_PRIMARY: String(company?.color_primario || ''),
    BOT_BRAND_CTA: String(company?.color_cta || ''),
    BOT_BRAND_ACCENT: String(company?.color_acento || ''),
    BOT_BRAND_CHECKS: String(company?.color_checks || ''),
    BOT_BRAND_BACKGROUND: String(company?.color_fondo || ''),
    NO_PAUSE: '1',
  }

  try {
    fs.writeFileSync(PROMPT_FILE, finalPrompt, 'utf-8')
    emit(onLog, '[IMAGE-AUTO] Prompt final del agente marketing enviado al generador visual.')

    const cdpPort = await detectProfileCdpPort(pythonBin, onLog)
    env.CDP_PROFILE_PORT = String(cdpPort)

    const promptResult = await runPythonScript(
      pythonBin,
      PROMPT_AUTOMATION_PY,
      [],
      env,
      onLog,
      '[IMAGE-AUTO][PROMPT]'
    )
    if (promptResult.code !== 0) {
      return {
        success: false,
        status: 'failed',
        error: 'No pude pegar el prompt en ChatGPT para generar la imagen.',
        prompt: finalPrompt,
      }
    }

    const downloadResult = await runPythonScript(
      pythonBin,
      DOWNLOAD_IMAGE_PY,
      [String(cdpPort)],
      env,
      onLog,
      '[IMAGE-AUTO][DOWNLOAD]'
    )
    if (downloadResult.code !== 0) {
      return {
        success: false,
        status: 'failed',
        error: 'No pude descargar la imagen generada para la campana.',
        prompt: finalPrompt,
      }
    }

    if (fs.existsSync(OVERLAY_LOGO_PY)) {
      const overlayResult = await runPythonScript(
        pythonBin,
        OVERLAY_LOGO_PY,
        [path.join(PROJECT_ROOT, 'output', 'images')],
        env,
        onLog,
        '[IMAGE-AUTO][LOGO]'
      )
      if (overlayResult.code !== 0) {
        emit(onLog, '[IMAGE-AUTO][LOGO] No pude aplicar el logo; seguire con la imagen descargada.')
      }
    }

    const asset = prepareLatestMarketingImageAsset(formatConfig)
    if (!asset?.preparedPath) {
      return {
        success: false,
        status: 'failed',
        error: 'La imagen se genero, pero no pude prepararla como asset para la campana.',
        prompt: finalPrompt,
      }
    }

    return {
      success: true,
      status: 'generated',
      prompt: finalPrompt,
      asset,
    }
  } catch (error) {
    return {
      success: false,
      status: 'failed',
      error: error instanceof Error ? error.message : 'No pude generar la imagen automatica.',
      prompt: finalPrompt,
    }
  } finally {
    if (promptExisted) {
      fs.writeFileSync(PROMPT_FILE, previousPrompt, 'utf-8')
    } else {
      try {
        fs.unlinkSync(PROMPT_FILE)
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

module.exports = {
  buildMarketingImagePrompt,
  generateMarketingImageAsset,
}
