const fs = require('fs')
const path = require('path')
const { shell } = require('electron')
const { PROJECT_ROOT } = require('../config/project-paths')

const BROCHURES_DIR = path.join(PROJECT_ROOT, 'output', 'brochures')
const BROCHURE_HTML = path.join(PROJECT_ROOT, 'core', 'brochure_rpa', 'brochure_output.html')

function registerBrochureHandlers(ipcMain) {
  // Obtener el HTML del brochure mas reciente (para preview en iframe)
  ipcMain.handle('get-brochure-html', async () => {
    try {
      if (!fs.existsSync(BROCHURE_HTML)) {
        return { success: false, error: 'No hay HTML generado' }
      }
      const html = fs.readFileSync(BROCHURE_HTML, 'utf-8')
      if (!html.trim()) {
        return { success: false, error: 'HTML vacio' }
      }
      return { success: true, html }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Obtener el PDF mas reciente como base64
  ipcMain.handle('get-latest-brochure', async () => {
    try {
      if (!fs.existsSync(BROCHURES_DIR)) {
        return { success: false, error: 'No existe directorio de brochures' }
      }

      const files = _listPdfFiles()
      if (!files.length) {
        return { success: false, error: 'No hay brochures generados' }
      }

      const latest = files[0]
      const data = fs.readFileSync(latest.path)
      const base64 = data.toString('base64')

      return {
        success: true,
        fileName: latest.name,
        filePath: latest.path,
        dataUrl: `data:application/pdf;base64,${base64}`,
        size: data.length,
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Listar historial de brochures
  ipcMain.handle('list-brochures', async () => {
    try {
      return _listPdfFiles()
    } catch {
      return []
    }
  })

  // Abrir PDF con la app del sistema (Adobe, Chrome, etc)
  ipcMain.handle('open-brochure-pdf', async (_event, filePath) => {
    try {
      const target = filePath || ''
      if (!target || !fs.existsSync(target)) {
        // Abrir el mas reciente
        const files = _listPdfFiles()
        if (files.length) {
          shell.openPath(files[0].path)
          return { success: true }
        }
        return { success: false, error: 'No hay PDF para abrir' }
      }
      shell.openPath(target)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

function _listPdfFiles() {
  if (!fs.existsSync(BROCHURES_DIR)) return []
  return fs.readdirSync(BROCHURES_DIR)
    .filter(f => f.endsWith('.pdf') && f.startsWith('brochure_'))
    .map(f => {
      const fullPath = path.join(BROCHURES_DIR, f)
      const stat = fs.statSync(fullPath)
      return {
        name: f,
        path: fullPath,
        size: stat.size,
        sizeLabel: `${(stat.size / 1024).toFixed(1)} KB`,
        createdAt: stat.mtimeMs,
        date: new Date(stat.mtimeMs).toLocaleString('es-CO'),
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

module.exports = { registerBrochureHandlers }
