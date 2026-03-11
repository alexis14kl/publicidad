// Bootstrap: fix electron module resolution
// When node_modules/electron exists, require('electron') resolves to
// the npm package (which returns the exe path) instead of Electron's internal module.
// This bootstrap patches Module._resolveFilename to prevent that.

const Module = require('module')
const path = require('path')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'electron') {
    // Return 'electron' as-is so Electron's internal loader handles it
    return 'electron'
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}

// Now load the actual main process
require('./main.js')
