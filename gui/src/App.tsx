import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { Header } from './components/Header'
import { StatusCard } from './components/StatusCard'
import { ControlPanel } from './components/ControlPanel'
import { LastJobCard } from './components/LastJobCard'
import { DualLogViewer } from './components/DualLogViewer'
import { useBotStatus } from './hooks/useBotStatus'
import { usePollerProcess } from './hooks/usePollerProcess'
import { useLogTail } from './hooks/useLogTail'
import { useBotLogTail } from './hooks/useBotLogTail'
import { useLastJob } from './hooks/useLastJob'
import { onMarketingRunUpdate, runMarketingCampaignPreview } from './lib/commands'
import type { MarketingRunUpdate } from './lib/types'

function MarketingCampaignModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [budget, setBudget] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [runState, setRunState] = useState<'idle' | 'running' | 'success' | 'warning' | 'error'>('idle')
  const [runSummary, setRunSummary] = useState('Completa el formulario para ejecutar el agente.')
  const [runLines, setRunLines] = useState<string[]>([])
  const [preview, setPreview] = useState<MarketingRunUpdate['preview'] | null>(null)

  const validationMessage = useMemo(() => {
    if (!budget || !startDate || !endDate) return 'Completa los 3 datos para continuar.'
    if (Number(budget) <= 0) return 'El presupuesto debe ser mayor a 0.'
    if (endDate < startDate) return 'La fecha de fin no puede ser menor que la fecha de inicio.'
    return 'Formulario listo para continuar a la vista previa de la campaña.'
  }, [budget, startDate, endDate])

  useEffect(() => {
    const unsubscribe = onMarketingRunUpdate((update) => {
      if (update.type === 'status' && update.status) {
        setRunState(update.status)
        if (update.summary) setRunSummary(update.summary)
      }
      if (update.type === 'log' && update.line) {
        setRunLines((prev) => [...prev, update.line].slice(-18))
      }
      if (update.type === 'done') {
        if (update.status) setRunState(update.status)
        if (update.summary) setRunSummary(update.summary)
        if (update.preview) setPreview(update.preview)
      }
    })
    return unsubscribe
  }, [])

  const canRun =
    !!budget &&
    !!startDate &&
    !!endDate &&
    Number(budget) > 0 &&
    endDate >= startDate &&
    runState !== 'running'

  const handleRun = async () => {
    if (!canRun) return
    setRunLines([])
    setPreview(null)
    setRunState('running')
    setRunSummary('Ejecutando agente de marketing...')
    await runMarketingCampaignPreview({ budget, startDate, endDate })
  }

  if (!open) return null

  return (
    <div className="marketing-modal-backdrop" onClick={onClose}>
      <section
        className="marketing-modal glass-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="marketing-modal__header">
          <div>
            <p className="marketing-modal__eyebrow">Agente de Marketing</p>
            <h2 className="marketing-modal__title">Campana Facebook Ads</h2>
          </div>
          <button className="btn btn--small btn--ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="marketing-modal__body">
          <div className="marketing-top-grid">
            <div className="marketing-copy">
              <p>
                jhordan, para avanzar con la campana necesito estos 3 datos primero:
              </p>
              <ol className="marketing-copy__list">
                <li>Presupuesto maximo a gastar.</li>
                <li>Fecha de inicio de la campana.</li>
                <li>Fecha de fin de la campana.</li>
              </ol>
            </div>

            <div className="marketing-status-card">
              <div className="card-header">
                <span className="card-icon">&#9881;</span>
                <span className="card-title">Estado del Agente</span>
              </div>
              <div className="status-grid">
                <div className="status-item">
                  <span className="status-item-label">Estado</span>
                  <span className={`status-badge marketing-status-badge marketing-status-badge--${runState}`}>
                    {runState === 'running'
                      ? 'Ejecutando'
                      : runState === 'success'
                        ? 'Listo'
                        : runState === 'warning'
                          ? 'Pre-flight'
                          : runState === 'error'
                            ? 'Error'
                            : 'Esperando'}
                  </span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Objetivo</span>
                  <span className="status-item-value">Leads</span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Canal</span>
                  <span className="status-item-value">Facebook Ads MCP</span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Resumen</span>
                  <span className="status-item-value marketing-status-summary">{runSummary}</span>
                </div>
              </div>
            </div>
          </div>

          <form className="marketing-form">
            <label className="marketing-field">
              <span>Presupuesto maximo</span>
              <input
                type="number"
                min="1"
                step="0.01"
                placeholder="Ej. 500000"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
              />
            </label>

            <label className="marketing-field">
              <span>Fecha de inicio</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>

            <label className="marketing-field">
              <span>Fecha de fin</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
          </form>

          <div className="marketing-rules">
            <p className="marketing-rules__title">Reglas activas</p>
            <ul className="marketing-rules__list">
              <li>Objetivo: clientes potenciales.</li>
              <li>URL: noyecode.com.</li>
              <li>Pais publico: Colombia.</li>
              <li>Formulario: nombre, apellido, correo y numero de telefono.</li>
              <li>Imagenes: las de la biblioteca de fotos.</li>
              <li>El resto de campos los completara el agente de marketing para atraer clientes.</li>
            </ul>
          </div>

          <div className="marketing-notes">
            <p>
              Punto importante: en esta sesion no veo un servidor MCP de Facebook Ads disponible,
              asi que el boton ejecuta el flujo de preparacion y verificacion para mostrarte como
              se armaria la campana y en que punto quedaria bloqueada la publicacion real.
            </p>
            <p>
              Antes de publicar, se mostrara una vista previa completa de la campana y se pedira
              consentimiento explicito para publicarla.
            </p>
            <p>
              Si quieres cambiar algo en ese punto, se haran los ajustes antes de cualquier publicacion.
            </p>
          </div>

          <div className="marketing-execution">
            <div className="log-header">
              <div className="card-header">
                <span className="card-icon">&#9654;</span>
                <span className="card-title">Ejecucion del Agente</span>
                <span className="log-count">{runLines.length} lineas</span>
              </div>
            </div>
            <div className="log-content marketing-log-content">
              {runLines.length === 0 ? (
                <p className="no-data">Aun no se ha ejecutado el agente.</p>
              ) : (
                runLines.map((line, index) => (
                  <div key={`${line}-${index}`} className="log-line log-info">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>

          {preview && (
            <div className="marketing-preview">
              <div className="card-header">
                <span className="card-icon">&#128203;</span>
                <span className="card-title">Vista Previa de Campana</span>
              </div>
              <div className="job-grid">
                <div className="job-item">
                  <span className="job-label">Objetivo</span>
                  <span className="job-value">{preview.objective}</span>
                </div>
                <div className="job-item">
                  <span className="job-label">URL</span>
                  <span className="job-value">{preview.url}</span>
                </div>
                <div className="job-item">
                  <span className="job-label">Pais</span>
                  <span className="job-value">{preview.country}</span>
                </div>
                <div className="job-item">
                  <span className="job-label">Presupuesto</span>
                  <span className="job-value">{preview.budget}</span>
                </div>
                <div className="job-item">
                  <span className="job-label">Fechas</span>
                  <span className="job-value">{preview.startDate} {'->'} {preview.endDate}</span>
                </div>
                <div className="job-item">
                  <span className="job-label">Formulario</span>
                  <span className="job-value">{preview.formFields.join(', ')}</span>
                </div>
                <div className="job-item">
                  <span className="job-label">MCP</span>
                  <span className={`job-badge ${preview.mcpAvailable ? 'badge--success' : 'badge--error'}`}>
                    {preview.mcpAvailable ? 'Disponible' : 'No disponible'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="marketing-modal__footer">
          <span className="marketing-validation">{validationMessage}</span>
          <button
            className="btn btn--start"
            disabled={!canRun}
            onClick={handleRun}
          >
            {runState === 'running' ? 'Ejecutando agente...' : 'Continuar a vista previa'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default function App() {
  const [marketingOpen, setMarketingOpen] = useState(false)
  const botStatus = useBotStatus()
  const poller = usePollerProcess()
  const { lines: workerLines, clearLines: clearWorkerLines } = useLogTail()
  const { lines: botLines, clearLines: clearBotLines } = useBotLogTail()
  const lastJob = useLastJob()

  return (
    <div className="app">
      <Header status={botStatus} />
      <div className="top-actions">
        <button className="btn btn--marketing" onClick={() => setMarketingOpen(true)}>
          Abrir Agente Marketing
        </button>
      </div>
      <main className="main-grid">
        <StatusCard status={botStatus} />
        <ControlPanel
          botStatus={botStatus}
          pollerRunning={poller.running}
          pollerLoading={poller.loading}
          onStartPoller={poller.start}
          onStopPoller={poller.stop}
        />
        <LastJobCard job={lastJob} />
      </main>
      <DualLogViewer
        workerLines={workerLines}
        onClearWorker={clearWorkerLines}
        botLines={botLines}
        onClearBot={clearBotLines}
      />
      <MarketingCampaignModal open={marketingOpen} onClose={() => setMarketingOpen(false)} />
    </div>
  )
}
