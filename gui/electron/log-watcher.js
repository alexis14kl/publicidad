const fs = require('fs')
const path = require('path')
const { PROJECT_ROOT } = require('./config/project-paths')
const state = require('./state')

function startLogWatcher() {
  const logPath = path.join(PROJECT_ROOT, 'logs', 'job_poller.log')

  try {
    state.lastLogSize = fs.statSync(logPath).size
  } catch {
    state.lastLogSize = 0
  }

  state.logWatcherInterval = setInterval(() => {
    if (!state.mainWindow) return

    try {
      const stat = fs.statSync(logPath)

      if (stat.size < state.lastLogSize) {
        state.lastLogSize = 0
      }

      if (stat.size > state.lastLogSize) {
        // Use shared read mode to avoid EBUSY on Windows
        const bytesToRead = stat.size - state.lastLogSize
        let fd
        try {
          fd = fs.openSync(logPath, fs.constants.O_RDONLY | 0, 0o444)
          const buffer = Buffer.alloc(bytesToRead)
          fs.readSync(fd, buffer, 0, bytesToRead, state.lastLogSize)
          fs.closeSync(fd)
          fd = null

          const newLines = buffer.toString('utf-8').split('\n').filter(l => l.trim())
          if (newLines.length > 0) {
            state.mainWindow.webContents.send('log-new-lines', newLines)
          }
          state.lastLogSize = stat.size
        } catch (readErr) {
          // File may be locked by another process — skip this cycle
          if (fd) try { fs.closeSync(fd) } catch {}
        }
      }
    } catch { /* file may not exist yet */ }
  }, 500)
}

function startBotLogWatcher() {
  const logPath = path.join(PROJECT_ROOT, 'logs', 'bot_runner_last.log')

  try {
    state.lastBotLogSize = fs.statSync(logPath).size
  } catch {
    state.lastBotLogSize = 0
  }

  state.botLogWatcherInterval = setInterval(() => {
    if (!state.mainWindow) return

    try {
      const stat = fs.statSync(logPath)

      if (stat.size < state.lastBotLogSize) {
        state.lastBotLogSize = 0
      }

      if (stat.size > state.lastBotLogSize) {
        const bytesToRead = stat.size - state.lastBotLogSize
        let fd
        try {
          fd = fs.openSync(logPath, fs.constants.O_RDONLY | 0, 0o444)
          const buffer = Buffer.alloc(bytesToRead)
          fs.readSync(fd, buffer, 0, bytesToRead, state.lastBotLogSize)
          fs.closeSync(fd)
          fd = null

          const newLines = buffer.toString('utf-8').split('\n').filter(l => l.trim())
          if (newLines.length > 0) {
            state.mainWindow.webContents.send('bot-log-lines', newLines)
          }
          state.lastBotLogSize = stat.size
        } catch (readErr) {
          if (fd) try { fs.closeSync(fd) } catch {}
        }
      }
    } catch { /* file may not exist yet */ }
  }, 500)
}

module.exports = {
  startLogWatcher,
  startBotLogWatcher,
}
