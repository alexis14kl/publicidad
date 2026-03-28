const fs = require('fs')
const path = require('path')
const workerManager = require('../services/worker-manager')

function registerJobHandlers(ipcMain) {
  ipcMain.handle('enqueue-job', async (_event, payload) => {
    try {
      const jobId = workerManager.enqueueJob({
        action: String(payload.action || 'run_full_cycle'),
        workerType: payload.workerType || undefined,
        resourceKey: payload.resourceKey != null ? payload.resourceKey : undefined,
        payload: payload.payload || {},
        priority: typeof payload.priority === 'number' ? payload.priority : 50,
        source: String(payload.source || 'gui'),
        companyName: String(payload.companyName || ''),
      })
      return { success: true, jobId }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('cancel-job', async (_event, jobId) => {
    try {
      const cancelled = workerManager.cancelJob(String(jobId))
      return { success: cancelled }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('list-jobs', async (_event, filter = {}) => {
    try {
      return workerManager.listJobs({
        status: filter.status || undefined,
        limit: typeof filter.limit === 'number' ? filter.limit : 50,
      })
    } catch {
      return []
    }
  })

  ipcMain.handle('get-job-detail', async (_event, jobId) => {
    try {
      return workerManager.getJobDetail(String(jobId))
    } catch {
      return null
    }
  })

  ipcMain.handle('get-job-log-lines', async (_event, jobId, count = 200) => {
    try {
      const detail = workerManager.getJobDetail(String(jobId))
      if (!detail || !detail.log_file) return []
      const logPath = detail.log_file
      if (!fs.existsSync(logPath)) return []
      const content = fs.readFileSync(logPath, 'utf-8')
      const lines = content.split('\n')
      return lines.slice(-count)
    } catch {
      return []
    }
  })
}

module.exports = { registerJobHandlers }
