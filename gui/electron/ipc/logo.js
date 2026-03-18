const fs = require('fs')
const path = require('path')
const { dialog } = require('electron')
const { PROJECT_ROOT } = require('../config/project-paths')

// ---------------------------------------------------------------------------
// Logo management
// ---------------------------------------------------------------------------
const LOGOS_DIR = path.join(PROJECT_ROOT, 'utils', 'logos')
const COMPANY_LOGOS_DIR = path.join(LOGOS_DIR, 'companies')
const ACTIVE_LOGO = path.join(PROJECT_ROOT, 'utils', 'logoapporange.png')

function ensureLogosDir() {
  if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR, { recursive: true })
}

function ensureCompanyLogosDir() {
  ensureLogosDir()
  if (!fs.existsSync(COMPANY_LOGOS_DIR)) fs.mkdirSync(COMPANY_LOGOS_DIR, { recursive: true })
}

function registerLogoHandlers(ipcMain) {
  ipcMain.handle('get-logo-path', async () => {
    if (!fs.existsSync(ACTIVE_LOGO)) return null
    return `file://${ACTIVE_LOGO.replace(/\\/g, '/')}?t=${Date.now()}`
  })

  ipcMain.handle('change-logo', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar logo',
      filters: [{ name: 'Imagenes', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true }

    const src = result.filePaths[0]
    const ext = path.extname(src).toLowerCase()
    const stamp = new Date().toISOString().replace(/[:\-T]/g, '').slice(0, 14)
    const historyName = `logo_${stamp}${ext}`

    ensureLogosDir()
    fs.copyFileSync(src, path.join(LOGOS_DIR, historyName))
    fs.copyFileSync(src, ACTIVE_LOGO)

    const logoUrl = `file://${ACTIVE_LOGO.replace(/\\/g, '/')}?t=${Date.now()}`
    return { success: true, logoUrl, historyName }
  })

  ipcMain.handle('select-company-logo-svg', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar logo SVG',
      filters: [{ name: 'SVG', extensions: ['svg'] }],
      properties: ['openFile'],
    })

    if (result.canceled || !result.filePaths.length) {
      return { success: false, canceled: true }
    }

    const src = result.filePaths[0]
    const ext = path.extname(src).toLowerCase()
    if (ext !== '.svg') {
      return { success: false, error: 'Solo se permiten archivos SVG.' }
    }

    const safeBaseName = path.basename(src, ext).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'logo'
    const stamp = new Date().toISOString().replace(/[:\-T]/g, '').slice(0, 14)
    const historyName = `${safeBaseName}_${stamp}.svg`
    const dest = path.join(COMPANY_LOGOS_DIR, historyName)

    ensureCompanyLogosDir()
    fs.copyFileSync(src, dest)

    return {
      success: true,
      logoPath: path.join('utils', 'logos', 'companies', historyName).replace(/\\/g, '/'),
      logoName: historyName,
      logoUrl: `file://${dest.replace(/\\/g, '/')}?t=${Date.now()}`,
    }
  })

  ipcMain.handle('list-logos', async () => {
    ensureLogosDir()
    const validExt = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp'])
    const files = fs.readdirSync(LOGOS_DIR)
      .filter(f => validExt.has(path.extname(f).toLowerCase()))
      .sort()
      .reverse()
    return files.map(f => ({
      filename: f,
      url: `file://${path.join(LOGOS_DIR, f).replace(/\\/g, '/')}?t=${Date.now()}`,
    }))
  })

  ipcMain.handle('set-active-logo', async (_event, filename) => {
    const src = path.join(LOGOS_DIR, filename)
    if (!fs.existsSync(src)) return { success: false, error: 'Archivo no encontrado' }
    fs.copyFileSync(src, ACTIVE_LOGO)
    const logoUrl = `file://${ACTIVE_LOGO.replace(/\\/g, '/')}?t=${Date.now()}`
    return { success: true, logoUrl }
  })
}

module.exports = { registerLogoHandlers }
