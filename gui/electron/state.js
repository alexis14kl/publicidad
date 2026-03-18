// Shared mutable state singleton.
// Every module that needs access to app-wide state imports this object
// and reads/writes its properties directly.

module.exports = {
  mainWindow: null,
  pollerProcess: null,
  botProcess: null,
  logWatcherInterval: null,
  botLogWatcherInterval: null,
  lastLogSize: 0,
  lastBotLogSize: 0,
  marketingRunInProgress: false,
  marketingMonitorServer: null,
  marketingMonitorPort: 0,
  marketingMonitorClients: [],
  marketingMonitorEvents: [],
  marketingMonitorNextId: 1,
  facebookVisualContext: null,
  facebookVisualPage: null,
  facebookVisualExecutable: '',
}
