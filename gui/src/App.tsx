import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { Header } from './components/Header'
import { PreflightBanner } from './components/PreflightBanner'
import { StatusCard } from './components/StatusCard'
import { ControlPanel } from './components/ControlPanel'
import { LastJobCard } from './components/LastJobCard'
import { DualLogViewer } from './components/DualLogViewer'
import { SettingsPage } from './components/SettingsPage'
import { CompanyProfilesPage } from './components/CompanyProfilesPage'
import { useBotStatus } from './hooks/useBotStatus'
import { usePollerProcess } from './hooks/usePollerProcess'
import { useLogTail } from './hooks/useLogTail'
import { useBotLogTail } from './hooks/useBotLogTail'
import { useLastJob } from './hooks/useLastJob'
import { generateDefaultPrompt, onMarketingRunUpdate, runMarketingCampaignPreview, startBot, stopBot } from './lib/commands'
import type { MarketingRunUpdate, PromptHistoryEntry } from './lib/types'
import { IMAGE_FORMAT_GROUPS } from './lib/types'

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
        const line = update.line
        setRunLines((prev) => {
          const nextLines: string[] = [...prev, line]
          return nextLines.slice(-18)
        })
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
              <p>jhordan, para avanzar con la campana necesito estos 3 datos primero:</p>
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

          <div className="marketing-section">
            <div className="card-header">
              <span className="card-icon">&#9998;</span>
              <span className="card-title">Formulario de Campana</span>
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
          </div>

          <div className="marketing-grid">
            <div className="marketing-execution">
              <div className="card-header">
                <span className="card-icon">&#9654;</span>
                <span className="card-title">Ejecucion del Agente</span>
              </div>
              <div className="marketing-execution__content">
                <div className="status-item">
                  <span className="status-item-label">Objetivo</span>
                  <span className="status-item-value">Clientes potenciales</span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Landing</span>
                  <span className="status-item-value">noyecode.com</span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Publico</span>
                  <span className="status-item-value">Colombia</span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Resumen</span>
                  <span className="status-item-value marketing-status-summary">{runSummary}</span>
                </div>
              </div>
            </div>

            <div className="marketing-log-panel">
              <div className="log-header">
                <div className="card-header">
                  <span className="card-icon">&#128196;</span>
                  <span className="card-title">Log del Agente</span>
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
                    <span className="job-label">Lead Forms</span>
                    <span className="job-value">
                      {preview.leadgenFormsLoaded
                        ? preview.leadgenForms && preview.leadgenForms.length > 0
                          ? `${preview.leadgenForms.length} formulario(s) encontrado(s)`
                          : 'Sin formularios encontrados'
                        : 'Pendiente de consulta'}
                    </span>
                  </div>
                  <div className="job-item">
                    <span className="job-label">Formulario elegido</span>
                    <span className="job-value">
                      {preview.selectedLeadgenFormId
                        ? `${preview.selectedLeadgenFormName} (${preview.selectedLeadgenFormId})`
                        : 'Ninguno seleccionado'}
                    </span>
                  </div>
                  <div className="job-item">
                    <span className="job-label">Monitor navegador</span>
                    <span className="job-value">{preview.browserMonitorUrl || 'Se abre al ejecutar'}</span>
                  </div>
                  <div className="job-item">
                    <span className="job-label">Imagen usada</span>
                    <span className="job-value">
                      {preview.imageAsset
                        ? `${preview.imageAsset.fileName} ${preview.imageAsset.width && preview.imageAsset.height ? `(${preview.imageAsset.width}x${preview.imageAsset.height})` : ''}`
                        : 'Se detecta al ejecutar'}
                    </span>
                  </div>
                  <div className="job-item">
                    <span className="job-label">MCP</span>
                    <span className={`job-badge ${preview.mcpAvailable ? 'badge--success' : 'badge--error'}`}>
                      {preview.mcpAvailable ? 'Disponible' : 'No disponible'}
                    </span>
                  </div>
                </div>

                {preview.orchestrator && (
                  <>
                    <div className="card-header" style={{ marginTop: 16 }}>
                      <span className="card-icon">&#129504;</span>
                      <span className="card-title">Orquestador y Subagentes</span>
                    </div>
                    <div className="job-grid">
                      <div className="job-item">
                        <span className="job-label">Plan</span>
                        <span className="job-value">{preview.orchestrator.plan.task}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Cuenta / Tipo</span>
                        <span className="job-value">
                          {preview.orchestrator.execution.accountHint} {'/'} {preview.orchestrator.execution.campaignType}
                        </span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">ads-analyst</span>
                        <span className="job-value">
                          {preview.orchestrator.adsAnalyst.hook} {'|'} CTA: {preview.orchestrator.adsAnalyst.cta}
                        </span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Publico base</span>
                        <span className="job-value">{preview.orchestrator.adsAnalyst.audience}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">image-creator</span>
                        <span className="job-value">
                          {preview.orchestrator.imageCreator.style} {'|'} {preview.orchestrator.imageCreator.dimensions}
                        </span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Prompt visual</span>
                        <span className="job-value">{preview.orchestrator.imageCreator.prompt}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">marketing</span>
                        <span className="job-value">
                          {preview.orchestrator.marketing.verdict}. {preview.orchestrator.marketing.notes.join(' ')}
                        </span>
                      </div>
                    </div>
                  </>
                )}

                {!!preview.leadgenFormsLoaded && (
                  <>
                    <div className="card-header" style={{ marginTop: 16 }}>
                      <span className="card-icon">&#128221;</span>
                      <span className="card-title">Formularios Instant Form</span>
                    </div>
                    <div className="job-grid">
                      <div className="job-item">
                        <span className="job-label">Seleccion automatica</span>
                        <span className="job-value">
                          {preview.selectedLeadgenFormReason || 'Pendiente de evaluacion'}
                        </span>
                      </div>
                      {preview.leadgenForms && preview.leadgenForms.length > 0 ? (
                        preview.leadgenForms.map((form) => (
                          <div key={form.id} className="job-item">
                            <span className="job-label">{form.name}</span>
                            <span className="job-value">leadgen_form_id: {form.id}</span>
                            <span className="job-value">
                              Campos: {form.questions && form.questions.length > 0
                                ? form.questions.map((question) => question.key).join(', ')
                                : form.questionsError
                                  ? `No se pudieron leer las questions: ${form.questionsError}`
                                  : 'Sin questions visibles'}
                            </span>
                            <span className="job-value">
                              Validacion:{' '}
                              {form.requirements?.exactMatch
                                ? 'Cumple exacto: nombre, apellido, correo y telefono'
                                : form.requirements?.acceptableMatch
                                  ? 'Cumple parcial: usa full_name mas correo y telefono'
                                  : 'No cumple los 4 campos requeridos'}
                            </span>
                            <span className={`job-badge ${form.status === 'ACTIVE' ? 'badge--success' : 'badge--warn'}`}>
                              {form.status}
                            </span>
                            {preview.selectedLeadgenFormId === form.id && (
                              <span className="job-badge badge--success">Seleccionado</span>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="job-item">
                          <span className="job-label">Resultado</span>
                          <span className="job-value">No se encontraron formularios o Meta no permitio listarlos con el token actual.</span>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {preview.creativeDraftConfig && (
                  <>
                    <div className="card-header" style={{ marginTop: 16 }}>
                      <span className="card-icon">&#127912;</span>
                      <span className="card-title">Configuracion del Creativo</span>
                    </div>
                    <div className="job-grid">
                      <div className="job-item">
                        <span className="job-label">Lead Form enlazado</span>
                        <span className="job-value">{preview.creativeDraftConfig.leadgenFormId}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">CTA</span>
                        <span className="job-value">{preview.creativeDraftConfig.callToActionType}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Titular</span>
                        <span className="job-value">{preview.creativeDraftConfig.headline}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Mensaje</span>
                        <span className="job-value">{preview.creativeDraftConfig.message}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Estado</span>
                        <span className="job-value">{preview.creativeDraftConfig.adDraftStatus}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Imagen preparada</span>
                        <span className="job-value">{preview.creativeDraftConfig.imageAssetPath}</span>
                      </div>
                      {preview.metaCreative && (
                        <>
                          <div className="job-item">
                            <span className="job-label">Creative ID</span>
                            <span className="job-value">{preview.metaCreative.creativeId}</span>
                          </div>
                          <div className="job-item">
                            <span className="job-label">Image Hash</span>
                            <span className="job-value">{preview.metaCreative.imageHash}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}

                {preview.adDraftConfig && (
                  <>
                    <div className="card-header" style={{ marginTop: 16 }}>
                      <span className="card-icon">&#128227;</span>
                      <span className="card-title">Configuracion del Anuncio</span>
                    </div>
                    <div className="job-grid">
                      <div className="job-item">
                        <span className="job-label">Ad Set</span>
                        <span className="job-value">{preview.adDraftConfig.adsetId}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Nombre</span>
                        <span className="job-value">{preview.adDraftConfig.adName}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Estado</span>
                        <span className="job-value">{preview.adDraftConfig.status}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Creative</span>
                        <span className="job-value">{preview.adDraftConfig.creativeStatus}</span>
                      </div>
                      {preview.metaAd && (
                        <div className="job-item">
                          <span className="job-label">Ad ID</span>
                          <span className="job-value">{preview.metaAd.adId}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {!!preview.process?.length && (
                  <>
                    <div className="card-header" style={{ marginTop: 16 }}>
                      <span className="card-icon">&#128260;</span>
                      <span className="card-title">Proceso Completo de Creacion</span>
                    </div>
                    <div className="job-grid">
                      {preview.process.map((step, index) => (
                        <div key={step.id} className="job-item">
                          <span className="job-label">
                            Paso {index + 1}: {step.title}
                          </span>
                          <span className="job-value">{step.detail}</span>
                          <span
                            className={`job-badge ${
                              step.status === 'success'
                                ? 'badge--success'
                                : step.status === 'warning'
                                  ? 'badge--warn'
                                  : step.status === 'error'
                                    ? 'badge--error'
                                    : ''
                            }`}
                          >
                            {step.status === 'success'
                              ? 'Validado'
                              : step.status === 'warning'
                                ? 'Pendiente por requisitos'
                                : step.status === 'error'
                                  ? 'Error'
                                  : step.status === 'running'
                                    ? 'En curso'
                                    : 'Siguiente'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
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
  const [page, setPage] = useState<'home' | 'companies' | 'settings'>('home')
  const [marketingOpen, setMarketingOpen] = useState(false)
  const [botLoading, setBotLoading] = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')
  const [imagePromptHistory, setImagePromptHistory] = useState<PromptHistoryEntry[]>([])
  const [imageFormat, setImageFormat] = useState(() =>
    window.localStorage.getItem('imageFormat') || 'fb-vertical'
  )
  const botStatus = useBotStatus()
  const poller = usePollerProcess()
  const { lines: workerLines, clearLines: clearWorkerLines } = useLogTail()
  const { lines: botLines, clearLines: clearBotLines } = useBotLogTail()
  const lastJob = useLastJob()

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('imagePromptHistory')
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const history: PromptHistoryEntry[] = parsed
        .map((item: unknown) => {
          if (typeof item === 'string') {
            return { text: item.trim(), createdAt: null }
          }
          if (typeof item === 'object' && item !== null && 'text' in item) {
            const entry = item as { text: string; createdAt?: string | null }
            return { text: String(entry.text || '').trim(), createdAt: entry.createdAt ?? null }
          }
          return null
        })
        .filter((entry): entry is PromptHistoryEntry => entry !== null && entry.text !== '')
        .slice(0, 10)
      setImagePromptHistory(history)
    } catch {
      // ignore invalid localStorage state
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    generateDefaultPrompt()
      .then((result) => {
        if (!cancelled && result.success && result.prompt) {
          setImagePrompt((current) => current.trim() ? current : result.prompt)
        }
      })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [])

  const rememberPrompt = (prompt: string) => {
    const normalized = prompt.trim()
    if (!normalized) return
    const entry: PromptHistoryEntry = { text: normalized, createdAt: new Date().toISOString() }
    setImagePromptHistory((current) => {
      const next = [entry, ...current.filter((p) => p.text !== normalized)].slice(0, 10)
      try {
        window.localStorage.setItem('imagePromptHistory', JSON.stringify(next))
      } catch {
        // ignore storage failures (quota, disabled, etc.)
      }
      return next
    })
  }

  const handleChangeFormat = (value: string) => {
    setImageFormat(value)
    try {
      window.localStorage.setItem('imageFormat', value)
    } catch { /* ignore */ }
  }

  const isExecuting = botStatus.status === 'executing'

  const handleStartPoller = async () => {
    if (poller.running || poller.loading) return
    const prompt = imagePrompt.trim()
    if (!prompt) return
    rememberPrompt(prompt)
    await poller.start({ imagePrompt: prompt, imageFormat })
  }

  const handleStartBot = async () => {
    if (isExecuting || botLoading) return
    const prompt = imagePrompt.trim()
    if (!prompt) return
    setBotLoading(true)
    try {
      rememberPrompt(prompt)
      await startBot({ imagePrompt: prompt, imageFormat })
    } finally {
      setBotLoading(false)
    }
  }

  const handleStopBot = async () => {
    if (botLoading) return
    setBotLoading(true)
    try {
      await stopBot()
    } finally {
      setBotLoading(false)
    }
  }

  return (
    <div className="app">
      <Header status={botStatus} onOpenSettings={() => setPage('settings')} />
      <nav className="app-tabs">
        <button className={`app-tab ${page === 'home' ? 'app-tab--active' : ''}`} onClick={() => setPage('home')}>
          Panel
        </button>
        <button className={`app-tab ${page === 'companies' ? 'app-tab--active' : ''}`} onClick={() => setPage('companies')}>
          Empresas
        </button>
        <button className={`app-tab ${page === 'settings' ? 'app-tab--active' : ''}`} onClick={() => setPage('settings')}>
          Configuraciones
        </button>
      </nav>

      {page === 'home' && (
        <>
          <PreflightBanner />
          <div className="top-actions">
            <button className="btn btn--marketing" onClick={() => setMarketingOpen(true)}>
              Abrir Agente Marketing
            </button>
          </div>
          <main className="main-grid">
            <StatusCard status={botStatus} />
            <ControlPanel
              botStatus={botStatus}
              botLoading={botLoading}
              imagePrompt={imagePrompt}
              pollerRunning={poller.running}
              pollerLoading={poller.loading}
              onStartPoller={handleStartPoller}
              onStopPoller={poller.stop}
              onStartBot={handleStartBot}
              onStopBot={handleStopBot}
            />
            <LastJobCard job={lastJob} />
          </main>
          <DualLogViewer
            workerLines={workerLines}
            onClearWorker={clearWorkerLines}
            botLines={botLines}
            onClearBot={clearBotLines}
            imagePrompt={imagePrompt}
            onChangeImagePrompt={setImagePrompt}
            imagePromptHistory={imagePromptHistory}
            imageFormat={imageFormat}
            onChangeImageFormat={handleChangeFormat}
            promptDisabled={isExecuting || botLoading}
          />
        </>
      )}

      {page === 'companies' && <CompanyProfilesPage />}

      {page === 'settings' && <SettingsPage />}
      <MarketingCampaignModal open={marketingOpen} onClose={() => setMarketingOpen(false)} />
    </div>
  )
}
