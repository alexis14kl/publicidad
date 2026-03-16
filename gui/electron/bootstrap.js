// In Electron runtime we can load the main process directly.
// The fallback patch is kept only for plain Node execution paths.
if (!process.versions?.electron) {
  const Module = require('module')
  const originalResolveFilename = Module._resolveFilename

  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'electron') {
      return 'electron'
    }
    return originalResolveFilename.call(this, request, parent, isMain, options)
  }
}

require('./main.js')
