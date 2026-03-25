import { useEffect, useMemo, useState } from 'react'
import {
  getEnvConfig,
  onMarketingRunUpdate,
  runMarketingCampaignPreview,
  saveEnvConfig,
} from '../../api/commands'
import type { MarketingRunUpdate } from '../../api/types'
import { CITY_ZONE_OPTIONS, CONTACT_MODE_OPTIONS } from './constants'
import {
  buildMarketingPromptPreview,
  buildTrendOptions,
  extractMarketingDraftFromPrePrompt,
} from './utils'

type Step = 'describe' | 'configure' | 'execute'

export function MarketingCampaignModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [step, setStep] = useState<Step>('describe')
  const [prePrompt, setPrePrompt] = useState('')
  const [campaignIdea, setCampaignIdea] = useState('')
  const [city, setCity] = useState('')
  const [selectedZones, setSelectedZones] = useState<string[]>([])
  const [contactMode, setContactMode] = useState<'lead_form' | 'whatsapp'>('lead_form')
  const [useZoneIntelligence, setUseZoneIntelligence] = useState(true)
  const [useAudienceSegmentation, setUseAudienceSegmentation] = useState(true)
  const [generateImageFromMarketingPrompt, setGenerateImageFromMarketingPrompt] = useState(false)
  const [marketingPrompt, setMarketingPrompt] = useState('')
  const [promptEdited, setPromptEdited] = useState(false)
  const [budget, setBudget] = useState('')
  const [campaignDays, setCampaignDays] = useState('30')
  const [mcpAccessToken, setMcpAccessToken] = useState('')
  const [mcpPageAccessToken, setMcpPageAccessToken] = useState('')
  const [mcpPageId, setMcpPageId] = useState('')
  const [mcpAdAccountId, setMcpAdAccountId] = useState('')
  const [runState, setRunState] = useState<'idle' | 'running' | 'success' | 'warning' | 'error'>('idle')
  const [runSummary, setRunSummary] = useState('Completa el formulario para ejecutar el agente.')
  const [runLines, setRunLines] = useState<string[]>([])
  const [preview, setPreview] = useState<MarketingRunUpdate['preview'] | null>(null)
  const zoneOptions = city ? (CITY_ZONE_OPTIONS[city] || []) : []
  const [trendOptions, setTrendOptions] = useState<Array<{
    id: number
    label: string
    shortLabel: string
    city: string
    zones: string[]
    summary: string
    buyerIntent: string
    audienceSignals: string[]
  }>>([])
  const [selectedTrendId, setSelectedTrendId] = useState<number | null>(null)
  const [appliedPrePrompt, setAppliedPrePrompt] = useState('')
  const [selectedCompany, setSelectedCompany] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showPromptEditor, setShowPromptEditor] = useState(false)
  const [showFullPreview, setShowFullPreview] = useState(false)
  const selectedContactMode = CONTACT_MODE_OPTIONS.find((option) => option.value === contactMode) || CONTACT_MODE_OPTIONS[0]

  // Auto-generate dates: start = tomorrow, end = start + campaignDays
  const computedDates = useMemo(() => {
    const start = new Date()
    start.setDate(start.getDate() + 1)
    const end = new Date(start)
    end.setDate(end.getDate() + Math.max(1, Number(campaignDays) || 30))
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    return { startDate: fmt(start), endDate: fmt(end) }
  }, [campaignDays])

  const promptPreview = useMemo(
    () => buildMarketingPromptPreview({
      campaignIdea,
      city,
      zones: selectedZones,
      contactMode,
      budget,
      startDate: computedDates.startDate,
      endDate: computedDates.endDate,
    }),
    [budget, campaignIdea, city, contactMode, computedDates, selectedZones]
  )

  const audiencePreview = useMemo(() => {
    if (!prePrompt || !city) return 'Completa el pre-prompt y la ciudad sugerida para ver el publico sugerido.'
    const zonesLabel = selectedZones.length > 0 ? selectedZones.join(', ') : 'cobertura general de la ciudad'
    if (/veterinari|mascota|pet/i.test(prePrompt)) {
      return `Duenos de mascotas en ${city}, zonas ${zonesLabel}, 24-55 anos, interesados en bienestar animal, vacunas, grooming y atencion veterinaria.`
    }
    return `Personas en ${city}, zonas ${zonesLabel}, con interes o necesidad relacionada con ${campaignIdea || prePrompt}, 24-55 anos, con intencion de contacto o compra.`
  }, [campaignIdea, city, prePrompt, selectedZones])

  useEffect(() => {
    setSelectedZones((current) => current.filter((zone) => zoneOptions.includes(zone)))
  }, [zoneOptions])

  useEffect(() => {
    if (String(prePrompt || '').trim() === String(appliedPrePrompt || '').trim()) return
    setTrendOptions([])
    setSelectedTrendId(null)
    setCity('')
    setSelectedZones([])
  }, [appliedPrePrompt, prePrompt])

  useEffect(() => {
    if (!promptEdited) {
      setMarketingPrompt(promptPreview)
    }
  }, [promptEdited, promptPreview])

  useEffect(() => {
    if (!open) return
    try {
      setSelectedCompany(window.localStorage.getItem('selectedCompany') || '')
    } catch {
      setSelectedCompany('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getEnvConfig()
      .then((config) => {
        if (cancelled) return
        setMcpAccessToken(config.FB_ACCESS_TOKEN || '')
        setMcpPageAccessToken(config.FB_PAGE_ACCESS_TOKEN || '')
        setMcpPageId(config.FB_PAGE_ID || '')
        setMcpAdAccountId(config.FB_AD_ACCOUNT_ID || '')
      })
      .catch(() => {
        if (cancelled) return
        setMcpAccessToken('')
        setMcpPageAccessToken('')
        setMcpPageId('')
        setMcpAdAccountId('')
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    const unsubscribe = onMarketingRunUpdate((update) => {
      if (update.type === 'status' && update.status) {
        setRunState(update.status)
        if (update.summary) setRunSummary(update.summary)
      }
      if (update.type === 'log' && update.line) {
        const line = update.line
        setRunLines((prev) => [...prev, line].slice(-18))
      }
      if (update.type === 'done') {
        if (update.status) setRunState(update.status)
        if (update.summary) setRunSummary(update.summary)
        if (update.preview) setPreview(update.preview)
      }
    })
    return unsubscribe
  }, [])

  const canContinueToConfigure =
    !!prePrompt.trim() &&
    !!city &&
    trendOptions.length > 0

  const canRun =
    !!prePrompt &&
    !!city &&
    !!budget &&
    !!mcpAccessToken &&
    !!mcpAdAccountId &&
    Number(budget) > 0 &&
    runState !== 'running'

  const configValidation = useMemo(() => {
    if (!budget) return 'Define el presupuesto de la campana.'
    if (!mcpAccessToken || !mcpAdAccountId) return 'Agrega las credenciales de Meta Ads.'
    if (Number(budget) <= 0) return 'El presupuesto debe ser mayor a 0.'
    return null
  }, [budget, mcpAccessToken, mcpAdAccountId])

  const handleApplyPrePrompt = () => {
    const draft = extractMarketingDraftFromPrePrompt(prePrompt)
    if (!draft.campaignIdea) return

    const nextTrends = buildTrendOptions({
      prePrompt,
      selectedCity: draft.city || '',
      selectedZones: draft.zones,
    })

    setCampaignIdea(draft.campaignIdea)
    setAppliedPrePrompt(prePrompt)
    setTrendOptions(nextTrends)
    const defaultTrend = draft.city
      ? nextTrends.find((trend) => trend.city === draft.city) || nextTrends[0]
      : nextTrends[0]
    setSelectedTrendId(defaultTrend?.id || null)
    const nextCity = draft.city || defaultTrend?.city || ''
    if (nextCity) setCity(nextCity)
    const nextZones = draft.zones.length > 0
      ? draft.zones
      : defaultTrend?.zones || []
    setSelectedZones(nextZones)
    setPromptEdited(false)
    setRunSummary('Pre-prompt analizado. Revisa las tendencias detectadas.')
  }

  const handleRun = async () => {
    if (!canRun) return
    setRunLines([])
    setPreview(null)
    setRunState('running')
    setRunSummary('Guardando credenciales y ejecutando agente de marketing...')
    setStep('execute')

    try {
      await saveEnvConfig({
        FB_ACCESS_TOKEN: mcpAccessToken.trim(),
        FB_PAGE_ACCESS_TOKEN: mcpPageAccessToken.trim(),
        FB_PAGE_ID: mcpPageId.trim(),
        FB_AD_ACCOUNT_ID: mcpAdAccountId.trim(),
      })
      await runMarketingCampaignPreview({
        campaignIdea,
        companyName: selectedCompany,
        prePrompt,
        city,
        zones: selectedZones,
        contactMode,
        useZoneIntelligence,
        useAudienceSegmentation,
        generateImageFromMarketingPrompt,
        marketingPrompt,
        budget,
        startDate: computedDates.startDate,
        endDate: computedDates.endDate,
      })
    } catch (error) {
      setRunState('error')
      setRunSummary(error instanceof Error ? error.message : 'No pude guardar la configuracion del MCP Meta Ads.')
    }
  }

  if (!open) return null

  return (
    <div className="marketing-modal-backdrop" onClick={onClose}>
      <section
        className="marketing-modal glass-card"
        onClick={(event) => event.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="marketing-modal__header">
          <div>
            <p className="marketing-modal__eyebrow">Agente de Marketing</p>
            <h2 className="marketing-modal__title">Campana Facebook Ads</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`status-badge marketing-status-badge marketing-status-badge--${runState}`}>
              {runState === 'running' ? 'Ejecutando' : runState === 'success' ? 'Listo' : runState === 'error' ? 'Error' : 'Preparando'}
            </span>
            <button className="btn btn--small btn--ghost" onClick={onClose}>Cerrar</button>
          </div>
        </div>

        {/* ── Step indicator ── */}
        <div className="mkt-steps">
          <button
            className={`mkt-step ${step === 'describe' ? 'mkt-step--active' : ''} ${trendOptions.length > 0 ? 'mkt-step--done' : ''}`}
            onClick={() => setStep('describe')}
          >
            <span className="mkt-step__num">1</span>
            <span className="mkt-step__label">Describe tu campana</span>
          </button>
          <div className="mkt-step__line" />
          <button
            className={`mkt-step ${step === 'configure' ? 'mkt-step--active' : ''} ${canRun ? 'mkt-step--done' : ''}`}
            onClick={() => canContinueToConfigure && setStep('configure')}
            disabled={!canContinueToConfigure}
          >
            <span className="mkt-step__num">2</span>
            <span className="mkt-step__label">Configura</span>
          </button>
          <div className="mkt-step__line" />
          <button
            className={`mkt-step ${step === 'execute' ? 'mkt-step--active' : ''} ${runState === 'success' ? 'mkt-step--done' : ''}`}
            onClick={() => canRun && setStep('execute')}
            disabled={!canRun}
          >
            <span className="mkt-step__num">3</span>
            <span className="mkt-step__label">Ejecutar</span>
          </button>
        </div>

        <div className="marketing-modal__body">

          {/* ═══════════ STEP 1: Describe ═══════════ */}
          {step === 'describe' && (
            <>
              <div className="marketing-section">
                <label className="marketing-field marketing-field--full">
                  <span>Describe tu campana</span>
                  <textarea
                    className="marketing-prompt-textarea"
                    placeholder="Ej. Campaña de carros de color azul en Bogota, foco en Norte y Usaquen, para captar clientes interesados en financiamiento."
                    value={prePrompt}
                    onChange={(event) => setPrePrompt(event.target.value)}
                    style={{ minHeight: 120 }}
                  />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn--start"
                    onClick={handleApplyPrePrompt}
                    disabled={!prePrompt.trim()}
                    style={{ flex: 'none' }}
                  >
                    Analizar campana
                  </button>
                  <span className="helper-text" style={{ margin: 0 }}>
                    El sistema detectara ciudades, zonas y el tipo de comprador.
                  </span>
                </div>
              </div>

              {/* Trends */}
              {trendOptions.length > 0 && (
                <div className="marketing-section">
                  <div className="card-header">
                    <span className="card-icon">&#128205;</span>
                    <span className="card-title">Tendencias detectadas</span>
                  </div>
                  <div className="marketing-trend-tabs">
                    {trendOptions.map((trend) => {
                      const active = trend.id === selectedTrendId
                      return (
                        <button
                          key={trend.id}
                          type="button"
                          className={`marketing-trend-tab ${active ? 'marketing-trend-tab--active' : ''}`}
                          onClick={() => {
                            setSelectedTrendId(trend.id)
                            setCity(trend.city)
                            setSelectedZones(trend.zones)
                          }}
                        >
                          <span className="marketing-trend-tab__number">{String(trend.id).padStart(2, '0')}</span>
                          <span className="marketing-trend-tab__content">
                            <span className="marketing-trend-tab__label">{trend.label}</span>
                            <span className="marketing-trend-tab__hint">{trend.shortLabel}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  {trendOptions
                    .filter((trend) => trend.id === selectedTrendId)
                    .map((trend) => (
                      <div key={trend.id} className="marketing-trend-panel">
                        <div className="marketing-trend-panel__header">
                          <span className="marketing-trend-panel__title">{trend.city}</span>
                          <span className="marketing-trend-panel__city">{trend.shortLabel}</span>
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>
                          {trend.summary}
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                          {trend.zones.map((z) => (
                            <span key={z} className="marketing-zone-chip marketing-zone-chip--active" style={{ cursor: 'default' }}>{z}</span>
                          ))}
                        </div>
                        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                          Comprador: {trend.buyerIntent}
                        </p>
                      </div>
                    ))}

                  {/* Zone selection */}
                  {zoneOptions.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>
                        Seleccionar zonas
                      </span>
                      <div className="marketing-zone-grid" style={{ marginTop: 8 }}>
                        {zoneOptions.map((zone) => {
                          const active = selectedZones.includes(zone)
                          return (
                            <button
                              key={zone}
                              type="button"
                              className={`marketing-zone-chip ${active ? 'marketing-zone-chip--active' : ''}`}
                              onClick={() => {
                                setSelectedZones((current) =>
                                  current.includes(zone)
                                    ? current.filter((item) => item !== zone)
                                    : [...current, zone]
                                )
                              }}
                            >
                              {zone}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Footer step 1 */}
              <div className="marketing-modal__footer">
                <span className="marketing-validation">
                  {!prePrompt.trim()
                    ? 'Escribe la descripcion de tu campana para comenzar.'
                    : !city
                      ? 'Haz clic en "Analizar campana" para detectar tendencias.'
                      : 'Todo listo. Continua al siguiente paso.'}
                </span>
                <button
                  className="btn btn--start"
                  disabled={!canContinueToConfigure}
                  onClick={() => setStep('configure')}
                >
                  Continuar
                </button>
              </div>
            </>
          )}

          {/* ═══════════ STEP 2: Configure ═══════════ */}
          {step === 'configure' && (
            <>
              {/* Summary of what was detected */}
              <div className="mkt-summary-bar">
                <div className="mkt-summary-item">
                  <span className="mkt-summary-label">Campana</span>
                  <span className="mkt-summary-value">{campaignIdea || prePrompt.slice(0, 60)}</span>
                </div>
                <div className="mkt-summary-item">
                  <span className="mkt-summary-label">Ciudad</span>
                  <span className="mkt-summary-value">{city}{selectedZones.length > 0 ? ` (${selectedZones.length} zonas)` : ''}</span>
                </div>
                <div className="mkt-summary-item">
                  <span className="mkt-summary-label">Publico</span>
                  <span className="mkt-summary-value" style={{ fontSize: 12 }}>{audiencePreview.slice(0, 80)}...</span>
                </div>
              </div>

              <div className="marketing-section">
                <div className="card-header">
                  <span className="card-icon">&#9881;</span>
                  <span className="card-title">Configuracion basica</span>
                </div>
                <form className="marketing-form">
                  <label className="marketing-field">
                    <span>Tipo de contacto</span>
                    <select
                      value={contactMode}
                      onChange={(event) => setContactMode(event.target.value === 'whatsapp' ? 'whatsapp' : 'lead_form')}
                    >
                      {CONTACT_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="marketing-field">
                    <span>Presupuesto (COP)</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Ej. 500000"
                      value={budget}
                      onChange={(event) => setBudget(event.target.value)}
                    />
                  </label>

                  <label className="marketing-field">
                    <span>Duracion (dias)</span>
                    <select
                      value={campaignDays}
                      onChange={(event) => setCampaignDays(event.target.value)}
                    >
                      <option value="7">7 dias</option>
                      <option value="14">14 dias</option>
                      <option value="30">30 dias (recomendado)</option>
                      <option value="60">60 dias</option>
                      <option value="90">90 dias</option>
                    </select>
                  </label>
                </form>
                <p className="helper-text" style={{ marginTop: 8 }}>
                  La campana inicia manana ({computedDates.startDate}) y termina el {computedDates.endDate}. Las credenciales de Meta se cargan desde Configuraciones.
                </p>
              </div>

              {/* Options */}
              <div className="marketing-section">
                <div className="card-header">
                  <span className="card-icon">&#10024;</span>
                  <span className="card-title">Opciones del agente</span>
                </div>
                <div className="mkt-options">
                  <label className="mkt-option">
                    <input type="checkbox" checked={useZoneIntelligence} onChange={(e) => setUseZoneIntelligence(e.target.checked)} />
                    <div>
                      <strong>Analisis de zonas</strong>
                      <span>Prioriza zonas con mayor afinidad e interaccion</span>
                    </div>
                  </label>
                  <label className="mkt-option">
                    <input type="checkbox" checked={useAudienceSegmentation} onChange={(e) => setUseAudienceSegmentation(e.target.checked)} />
                    <div>
                      <strong>Segmentacion de publico</strong>
                      <span>Detecta audiencias con mejor fit automaticamente</span>
                    </div>
                  </label>
                  <label className="mkt-option">
                    <input type="checkbox" checked={generateImageFromMarketingPrompt} onChange={(e) => setGenerateImageFromMarketingPrompt(e.target.checked)} />
                    <div>
                      <strong>Generar imagen automatica</strong>
                      <span>Crea el creativo visual con IA</span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Advanced (collapsible) */}
              <button
                className="mkt-collapsible"
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <span>Configuracion avanzada</span>
                <span>{showAdvanced ? '−' : '+'}</span>
              </button>
              {showAdvanced && (
                <div className="marketing-section">
                  <form className="marketing-form" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                    <label className="marketing-field">
                      <span>Meta Page Access Token</span>
                      <input
                        type="password"
                        placeholder="EAAB... (token de pagina)"
                        value={mcpPageAccessToken}
                        onChange={(event) => setMcpPageAccessToken(event.target.value)}
                      />
                    </label>
                    <label className="marketing-field">
                      <span>Facebook Page ID</span>
                      <input
                        type="text"
                        placeholder="115406607722279 (opcional)"
                        value={mcpPageId}
                        onChange={(event) => setMcpPageId(event.target.value)}
                      />
                    </label>
                  </form>
                  <p className="helper-text">
                    Si dejas vacio el Page ID, el sistema lo resolvera automaticamente con el token.
                  </p>
                </div>
              )}

              {/* Prompt editor (collapsible) */}
              <button
                className="mkt-collapsible"
                type="button"
                onClick={() => setShowPromptEditor(!showPromptEditor)}
              >
                <span>Editar prompt del agente</span>
                <span>{showPromptEditor ? '−' : '+'}</span>
              </button>
              {showPromptEditor && (
                <div className="marketing-section">
                  <label className="marketing-field marketing-field--full">
                    <span>Prompt que recibiran los agentes</span>
                    <textarea
                      className="marketing-prompt-textarea"
                      placeholder="El prompt se genera automaticamente..."
                      value={marketingPrompt}
                      onChange={(event) => {
                        setMarketingPrompt(event.target.value)
                        setPromptEdited(true)
                      }}
                    />
                  </label>
                  <div className="marketing-prompt-actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => {
                        setMarketingPrompt(promptPreview)
                        setPromptEdited(false)
                      }}
                    >
                      Regenerar prompt
                    </button>
                    <span className="helper-text">Puedes ajustar este texto antes de ejecutar.</span>
                  </div>
                </div>
              )}

              {/* Footer step 2 */}
              <div className="marketing-modal__footer">
                <button className="btn btn--ghost" onClick={() => setStep('describe')} style={{ flex: 'none' }}>
                  Atras
                </button>
                <span className="marketing-validation" style={{ flex: 1, textAlign: 'center' }}>
                  {configValidation || `${selectedContactMode.objective} | ${city} | ${campaignDays} dias | ${computedDates.startDate} → ${computedDates.endDate}`}
                </span>
                <button
                  className="btn btn--start"
                  disabled={!canRun}
                  onClick={handleRun}
                  style={{ flex: 'none', minWidth: 180 }}
                >
                  Ejecutar campana
                </button>
              </div>
            </>
          )}

          {/* ═══════════ STEP 3: Execute ═══════════ */}
          {step === 'execute' && (
            <>
              {/* Status */}
              <div className="mkt-execution-status">
                <div className={`mkt-status-indicator mkt-status-indicator--${runState}`}>
                  {runState === 'running' && <span className="mkt-spinner" />}
                  {runState === 'success' && '✓'}
                  {runState === 'error' && '✕'}
                  {runState === 'idle' && '●'}
                  {runState === 'warning' && '!'}
                </div>
                <div>
                  <strong style={{ fontSize: 15 }}>
                    {runState === 'running' ? 'Ejecutando agente...'
                      : runState === 'success' ? 'Campana creada exitosamente'
                        : runState === 'error' ? 'Error en la ejecucion'
                          : 'Preparando ejecucion'}
                  </strong>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{runSummary}</p>
                </div>
              </div>

              {/* Execution summary */}
              <div className="marketing-grid">
                <div className="marketing-execution">
                  <div className="card-header">
                    <span className="card-icon">&#9654;</span>
                    <span className="card-title">Resumen</span>
                  </div>
                  <div className="marketing-execution__content">
                    <div className="status-item">
                      <span className="status-item-label">Campana</span>
                      <span className="status-item-value">{campaignIdea || prePrompt.slice(0, 50)}</span>
                    </div>
                    <div className="status-item">
                      <span className="status-item-label">Ciudad</span>
                      <span className="status-item-value">{city}{selectedZones.length > 0 ? ` | ${selectedZones.join(', ')}` : ''}</span>
                    </div>
                    <div className="status-item">
                      <span className="status-item-label">Objetivo</span>
                      <span className="status-item-value">{selectedContactMode.objective}</span>
                    </div>
                    <div className="status-item">
                      <span className="status-item-label">Presupuesto</span>
                      <span className="status-item-value">${Number(budget).toLocaleString()} COP</span>
                    </div>
                    <div className="status-item">
                      <span className="status-item-label">Fechas</span>
                      <span className="status-item-value">{computedDates.startDate} → {computedDates.endDate} ({campaignDays} dias)</span>
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
                      <p className="no-data">Esperando actividad del agente...</p>
                    ) : (
                      runLines.map((line, index) => (
                        <div key={`${line}-${index}`} className="log-line log-info">
                          {line}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Full preview (collapsible, only after execution completes) */}
              {preview && (
                <>
                  <button
                    className="mkt-collapsible"
                    type="button"
                    onClick={() => setShowFullPreview(!showFullPreview)}
                  >
                    <span>Ver detalles completos de la campana</span>
                    <span>{showFullPreview ? '−' : '+'}</span>
                  </button>
                  {showFullPreview && (
                    <div className="marketing-preview">
                      <div className="card-header">
                        <span className="card-icon">&#128203;</span>
                        <span className="card-title">Vista Previa Completa</span>
                      </div>
                      <div className="job-grid">
                        <div className="job-item">
                          <span className="job-label">Concepto</span>
                          <span className="job-value">{preview.campaignIdea || 'Sin concepto'}</span>
                        </div>
                        <div className="job-item">
                          <span className="job-label">Objetivo</span>
                          <span className="job-value">{preview.objective}</span>
                        </div>
                        <div className="job-item">
                          <span className="job-label">URL destino</span>
                          <span className="job-value">{preview.url}</span>
                        </div>
                        <div className="job-item">
                          <span className="job-label">Ciudad / zonas</span>
                          <span className="job-value">
                            {preview.city || 'Sin ciudad'}
                            {preview.zones && preview.zones.length > 0 ? ` | ${preview.zones.join(', ')}` : ''}
                          </span>
                        </div>
                        <div className="job-item">
                          <span className="job-label">Canal</span>
                          <span className="job-value">{preview.contactMode === 'whatsapp' ? 'WhatsApp' : 'Contacto web'}</span>
                        </div>
                        <div className="job-item">
                          <span className="job-label">MCP</span>
                          <span className={`job-badge ${preview.mcpAvailable ? 'badge--success' : 'badge--error'}`}>
                            {preview.mcpAvailable ? 'Disponible' : 'No disponible'}
                          </span>
                        </div>
                        {preview.imageAsset && (
                          <div className="job-item">
                            <span className="job-label">Imagen</span>
                            <span className="job-value">{preview.imageAsset.fileName} {preview.imageAsset.width && preview.imageAsset.height ? `(${preview.imageAsset.width}x${preview.imageAsset.height})` : ''}</span>
                          </div>
                        )}
                      </div>

                      {preview.orchestrator && (
                        <>
                          <div className="card-header" style={{ marginTop: 16 }}>
                            <span className="card-icon">&#129504;</span>
                            <span className="card-title">Resultado del Orquestador</span>
                          </div>
                          <div className="job-grid">
                            <div className="job-item">
                              <span className="job-label">ads-analyst</span>
                              <span className="job-value">{preview.orchestrator.adsAnalyst.hook} | CTA: {preview.orchestrator.adsAnalyst.cta}</span>
                            </div>
                            <div className="job-item">
                              <span className="job-label">Publico</span>
                              <span className="job-value">{preview.orchestrator.adsAnalyst.audience}</span>
                            </div>
                            <div className="job-item">
                              <span className="job-label">image-creator</span>
                              <span className="job-value">{preview.orchestrator.imageCreator.style} | {preview.orchestrator.imageCreator.dimensions}</span>
                            </div>
                            <div className="job-item">
                              <span className="job-label">marketing</span>
                              <span className="job-value">{preview.orchestrator.marketing.verdict}</span>
                            </div>
                          </div>
                        </>
                      )}

                      {preview.creativeDraftConfig && (
                        <>
                          <div className="card-header" style={{ marginTop: 16 }}>
                            <span className="card-icon">&#127912;</span>
                            <span className="card-title">Creativo</span>
                          </div>
                          <div className="job-grid">
                            <div className="job-item">
                              <span className="job-label">Titular</span>
                              <span className="job-value">{preview.creativeDraftConfig.headline}</span>
                            </div>
                            <div className="job-item">
                              <span className="job-label">Mensaje</span>
                              <span className="job-value">{preview.creativeDraftConfig.message}</span>
                            </div>
                            <div className="job-item">
                              <span className="job-label">CTA</span>
                              <span className="job-value">{preview.creativeDraftConfig.callToActionType}</span>
                            </div>
                            <div className="job-item">
                              <span className="job-label">Estado</span>
                              <span className="job-value">{preview.creativeDraftConfig.adDraftStatus}</span>
                            </div>
                          </div>
                        </>
                      )}

                      {preview.adDraftConfig && (
                        <>
                          <div className="card-header" style={{ marginTop: 16 }}>
                            <span className="card-icon">&#128227;</span>
                            <span className="card-title">Anuncio</span>
                          </div>
                          <div className="job-grid">
                            <div className="job-item">
                              <span className="job-label">Nombre</span>
                              <span className="job-value">{preview.adDraftConfig.adName}</span>
                            </div>
                            <div className="job-item">
                              <span className="job-label">Estado</span>
                              <span className="job-value">{preview.adDraftConfig.status}</span>
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
                    </div>
                  )}
                </>
              )}

              {/* Footer step 3 */}
              <div className="marketing-modal__footer">
                <button className="btn btn--ghost" onClick={() => setStep('configure')} style={{ flex: 'none' }} disabled={runState === 'running'}>
                  Atras
                </button>
                <span className="marketing-validation" style={{ flex: 1, textAlign: 'center' }}>
                  {runState === 'running' ? 'El agente esta trabajando...' : runState === 'success' ? 'Campana creada. Revisa los detalles arriba.' : ''}
                </span>
                {runState !== 'running' && (
                  <button
                    className="btn btn--start"
                    onClick={handleRun}
                    disabled={!canRun}
                    style={{ flex: 'none', minWidth: 180 }}
                  >
                    {runState === 'success' || runState === 'error' ? 'Re-ejecutar' : 'Ejecutar campana'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
