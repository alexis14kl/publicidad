const http = require('http')
const { shell } = require('electron')
const state = require('../state')

function buildMarketingMonitorHtml() {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Monitor de Construccion de Campana</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: Arial, sans-serif; background: #0b1020; color: #eef2ff; }
    .wrap { max-width: 1040px; margin: 0 auto; padding: 24px; }
    .hero { background: linear-gradient(135deg, #13203d, #1c3258); border: 1px solid #31456e; border-radius: 20px; padding: 20px; }
    .hero h1 { margin: 0 0 8px; font-size: 28px; }
    .hero p { margin: 0; color: #cbd5e1; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 16px; }
    .card { background: rgba(15, 23, 42, 0.86); border: 1px solid #243b63; border-radius: 16px; padding: 14px; }
    .label { display: block; color: #93c5fd; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
    #events { display: grid; gap: 12px; margin-top: 20px; }
    .event { background: rgba(15, 23, 42, 0.92); border: 1px solid #243b63; border-left: 5px solid #60a5fa; border-radius: 16px; padding: 14px; }
    .event.success { border-left-color: #34d399; }
    .event.warning { border-left-color: #fbbf24; }
    .event.error { border-left-color: #f87171; }
    .event.running { border-left-color: #60a5fa; }
    .event .time { color: #94a3b8; font-size: 12px; margin-bottom: 6px; }
    .event .title { font-weight: 700; margin-bottom: 4px; }
    .event .text { color: #e2e8f0; white-space: pre-wrap; }
    .empty { color: #94a3b8; padding: 18px 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Construccion paso a paso de la campana</h1>
      <p>Esta vista se actualiza en vivo mientras el orquestador y Meta Ads van armando el borrador.</p>
      <div class="meta">
        <div class="card"><span class="label">Estado</span><strong id="state">Esperando ejecucion</strong></div>
        <div class="card"><span class="label">Ultimo resumen</span><strong id="summary">Sin actividad</strong></div>
        <div class="card"><span class="label">Monitor</span><strong>Tiempo real</strong></div>
      </div>
    </section>
    <section id="events"><div class="empty">Aun no hay eventos.</div></section>
  </div>
  <script>
    const eventsEl = document.getElementById('events')
    const stateEl = document.getElementById('state')
    const summaryEl = document.getElementById('summary')
    function renderEvent(event) {
      const empty = eventsEl.querySelector('.empty')
      if (empty) empty.remove()
      const div = document.createElement('div')
      div.className = 'event ' + (event.status || 'running')
      div.innerHTML = '<div class="time">' + event.time + '</div>' +
        '<div class="title">' + event.title + '</div>' +
        '<div class="text">' + event.text + '</div>'
      eventsEl.prepend(div)
    }
    function applyEvent(event) {
      if (event.status) stateEl.textContent = event.status
      if (event.summary) summaryEl.textContent = event.summary
      renderEvent(event)
    }
    fetch('/snapshot').then(r => r.json()).then(data => {
      if (Array.isArray(data.events)) {
        data.events.forEach((event) => applyEvent(event))
      }
    }).catch(() => {})
    const source = new EventSource('/events')
    source.onmessage = (message) => {
      try {
        applyEvent(JSON.parse(message.data))
      } catch (_) {}
    }
  </script>
</body>
</html>`
}

function broadcastMarketingMonitorEvent(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`
  state.marketingMonitorClients = state.marketingMonitorClients.filter((response) => {
    if (response.destroyed || response.writableEnded) return false
    try {
      response.write(payload)
      return true
    } catch {
      return false
    }
  })
}

function pushMarketingBrowserEvent(update) {
  const title =
    update.type === 'log'
      ? 'Paso de ejecucion'
      : update.type === 'done'
        ? 'Resultado final'
        : 'Estado del flujo'
  const text = update.line || update.summary || 'Sin detalle'
  const event = {
    id: state.marketingMonitorNextId++,
    time: new Date().toLocaleTimeString('es-CO', { hour12: false }),
    title,
    text,
    status: update.status || (update.type === 'done' ? 'success' : 'running'),
    summary: update.summary || '',
  }
  state.marketingMonitorEvents.push(event)
  state.marketingMonitorEvents = state.marketingMonitorEvents.slice(-120)
  broadcastMarketingMonitorEvent(event)
}

async function ensureMarketingMonitorServer() {
  if (state.marketingMonitorServer && state.marketingMonitorPort) {
    return `http://127.0.0.1:${state.marketingMonitorPort}`
  }

  state.marketingMonitorServer = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })
      response.write('\n')
      state.marketingMonitorClients.push(response)
      request.on('close', () => {
        state.marketingMonitorClients = state.marketingMonitorClients.filter((client) => client !== response)
      })
      return
    }

    if (url.pathname === '/snapshot') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ events: state.marketingMonitorEvents.slice().reverse() }))
      return
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(buildMarketingMonitorHtml())
  })

  await new Promise((resolve, reject) => {
    state.marketingMonitorServer.once('error', reject)
    state.marketingMonitorServer.listen(0, '127.0.0.1', () => {
      const address = state.marketingMonitorServer.address()
      state.marketingMonitorPort = typeof address === 'object' && address ? address.port : 0
      resolve()
    })
  })

  return `http://127.0.0.1:${state.marketingMonitorPort}`
}

async function openMarketingBrowserMonitor() {
  const url = await ensureMarketingMonitorServer()
  await shell.openExternal(url)
  return url
}

module.exports = {
  buildMarketingMonitorHtml,
  broadcastMarketingMonitorEvent,
  pushMarketingBrowserEvent,
  ensureMarketingMonitorServer,
  openMarketingBrowserMonitor,
}
