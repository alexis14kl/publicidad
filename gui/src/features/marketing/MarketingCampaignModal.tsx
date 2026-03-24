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
  buildAudienceSegmentationPreview,
  buildMarketingPromptPreview,
  buildTrendOptions,
  buildZoneIntelligencePreview,
  extractMarketingDraftFromPrePrompt,
} from './utils'

export function MarketingCampaignModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
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
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
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
  const selectedContactMode = CONTACT_MODE_OPTIONS.find((option) => option.value === contactMode) || CONTACT_MODE_OPTIONS[0]

  const validationMessage = useMemo(() => {
    if (!prePrompt || !city) return 'Escribe el pre-prompt y selecciona una tendencia con su ciudad y zonas populares.'
    if (!budget || !startDate || !endDate) return 'Completa presupuesto y fechas para continuar.'
    if (!mcpAccessToken || !mcpAdAccountId) return 'Completa las credenciales principales del MCP Meta Ads.'
    if (Number(budget) <= 0) return 'El presupuesto debe ser mayor a 0.'
    if (endDate < startDate) return 'La fecha de fin no puede ser menor que la fecha de inicio.'
    return 'Formulario listo para continuar a la vista previa de la campaña.'
  }, [budget, city, endDate, mcpAccessToken, mcpAdAccountId, prePrompt, startDate])

  const promptPreview = useMemo(
    () => buildMarketingPromptPreview({
      campaignIdea,
      city,
      zones: selectedZones,
      contactMode,
      budget,
      startDate,
      endDate,
    }),
    [budget, campaignIdea, city, contactMode, endDate, selectedZones, startDate]
  )

  const zoneIntelligencePreview = useMemo(
    () => buildZoneIntelligencePreview({
      enabled: useZoneIntelligence,
      prePrompt,
      campaignIdea,
      city,
      selectedZones,
    }),
    [campaignIdea, city, prePrompt, selectedZones, useZoneIntelligence]
  )

  const audienceSegmentationPreview = useMemo(
    () => buildAudienceSegmentationPreview({
      enabled: useAudienceSegmentation,
      prePrompt,
      campaignIdea,
      city,
    }),
    [campaignIdea, city, prePrompt, useAudienceSegmentation]
  )

  const audiencePreview = useMemo(() => {
    if (!prePrompt || !city) return 'Completa el pre-prompt y la ciudad sugerida para ver el publico sugerido.'
    const zonesLabel = selectedZones.length > 0 ? selectedZones.join(', ') : 'cobertura general de la ciudad'
    if (/veterinari|mascota|pet/i.test(prePrompt)) {
      return `Duenos de mascotas en ${city}, zonas ${zonesLabel}, 24-55 anos, interesados en bienestar animal, vacunas, grooming y atencion veterinaria.`
    }
    return `Personas en ${city}, zonas ${zonesLabel}, con interes o necesidad relacionada con ${campaignIdea || prePrompt}, 24-55 anos, con intencion de contacto o compra.`
  }, [campaignIdea, city, prePrompt, selectedZones])

  const visualPreview = useMemo(() => {
    if (!prePrompt || !city) return 'La direccion visual aparecera cuando completes el pre-prompt y la ciudad sugerida.'
    const contactContext = contactMode === 'whatsapp'
      ? 'con enfoque cercano, conversacional y listo para escribir por WhatsApp'
      : 'con enfoque de captacion y llamada clara al formulario'
    return `Imagen de Facebook Ads relacionada con "${campaignIdea || prePrompt}" en ${city}, ${contactContext}, composicion limpia, foco en el beneficio principal y contexto visual coherente con el negocio.`
  }, [campaignIdea, city, contactMode, prePrompt])

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

  const canRun =
    !!prePrompt &&
    !!city &&
    !!budget &&
    !!startDate &&
    !!endDate &&
    !!mcpAccessToken &&
    !!mcpAdAccountId &&
    Number(budget) > 0 &&
    endDate >= startDate &&
    runState !== 'running'

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
    setRunSummary('Pre-prompt enviado al resumen inteligente. Ahora puedes revisar las tendencias detectadas para posibles compradores.')
  }

  const handleRun = async () => {
    if (!canRun) return
    setRunLines([])
    setPreview(null)
    setRunState('running')
    setRunSummary('Guardando credenciales del MCP y ejecutando agente de marketing...')

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
        startDate,
        endDate,
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
              <p>Aqui puedes bajar una idea base y convertirla en un brief listo para copy, publico, zonas, creativo y lectura de tendencias.</p>
              <ol className="marketing-copy__list">
                <li>Pre-prompt base con el enfoque comercial de la campana.</li>
                <li>Tendencias detectadas con ciudad, zonas populares y comprador probable.</li>
                <li>Si quieres contacto web o contacto por WhatsApp.</li>
                <li>Editar el prompt final que se enviara a los agentes.</li>
                <li>Presupuesto maximo a gastar.</li>
                <li>Fecha de inicio de la campana.</li>
                <li>Fecha de fin de la campana.</li>
                <li>Meta Access Token y cuenta publicitaria del MCP.</li>
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
                  <span className="status-item-value">{selectedContactMode.objective}</span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Canal</span>
                  <span className="status-item-value">Facebook Ads MCP + {selectedContactMode.label}</span>
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
              <label className="marketing-field marketing-field--full">
                <span>Pre-prompt base de la campaña</span>
                <textarea
                  className="marketing-prompt-textarea"
                  placeholder="Ej. Campaña de carros de color azul en Bogota, foco en Norte y Usaquen, para captar clientes interesados en financiamiento."
                  value={prePrompt}
                  onChange={(event) => setPrePrompt(event.target.value)}
                />
              </label>

              <div className="marketing-field marketing-field--full">
                <span>Checks del orquestador</span>
                <div className="job-grid">
                  <label className="job-item" style={{ cursor: 'pointer' }}>
                    <span className="job-label">Analisis de zonas calientes</span>
                    <input
                      type="checkbox"
                      checked={useZoneIntelligence}
                      onChange={(event) => setUseZoneIntelligence(event.target.checked)}
                    />
                    <span className="job-value">Usar ads-analyst + seo-analyzer para priorizar zonas con mayor afinidad e interaccion.</span>
                  </label>
                  <label className="job-item" style={{ cursor: 'pointer' }}>
                    <span className="job-label">Segmentacion de publico</span>
                    <input
                      type="checkbox"
                      checked={useAudienceSegmentation}
                      onChange={(event) => setUseAudienceSegmentation(event.target.checked)}
                    />
                    <span className="job-value">Usar ads-analyst + seo-analyzer para detectar posibles clientes y audiencias con mejor fit.</span>
                  </label>
                  <label className="job-item" style={{ cursor: 'pointer' }}>
                    <span className="job-label">Generar imagen automatica</span>
                    <input
                      type="checkbox"
                      checked={generateImageFromMarketingPrompt}
                      onChange={(event) => setGenerateImageFromMarketingPrompt(event.target.checked)}
                    />
                    <span className="job-value">Toma el prompt final del agente marketing, genera la imagen y la usa en Contenido del anuncio si la automatizacion sale bien.</span>
                  </label>
                </div>
                <div className="marketing-prompt-actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={handleApplyPrePrompt}
                    disabled={!prePrompt.trim()}
                  >
                    Pasar al resumen inteligente
                  </button>
                  <span className="helper-text">
                    Este boton interpreta tu pre-prompt. Si escribes una ciudad concreta, solo veras esa ciudad; si no la escribes claramente, apareceran varias opciones sugeridas.
                  </span>
                </div>
              </div>

              <div className="marketing-field marketing-field--full">
                <span>Ciudades y tendencias detectadas</span>
                {trendOptions.length === 0 ? (
                  <span className="marketing-zone-empty">Pulsa "Pasar al resumen inteligente" para ver la ciudad detectada o las ciudades sugeridas para esta campaña.</span>
                ) : (
                  <>
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
                            <span className="marketing-trend-panel__title">Lectura para {trend.city}</span>
                            <span className="marketing-trend-panel__city">{trend.shortLabel}</span>
                          </div>
                          <div className="job-grid">
                            <div className="job-item">
                              <span className="job-label">Resumen</span>
                              <span className="job-value">{trend.summary}</span>
                            </div>
                            <div className="job-item">
                              <span className="job-label">Zonas populares</span>
                              <span className="job-value">{trend.zones.join(', ')}</span>
                            </div>
                            <div className="job-item">
                              <span className="job-label">Comprador probable</span>
                              <span className="job-value">{trend.buyerIntent}</span>
                            </div>
                            <div className="job-item">
                              <span className="job-label">Senales de interes</span>
                              <span className="job-value">{trend.audienceSignals.join(' | ')}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                  </>
                )}
                <span className="helper-text">
                  Al seleccionar una opcion, el formulario carga automaticamente esa ciudad y sus zonas recomendadas.
                </span>
              </div>

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

              <label className="marketing-field">
                <span>Meta Access Token</span>
                <input
                  type="password"
                  placeholder="EAAB..."
                  value={mcpAccessToken}
                  onChange={(event) => setMcpAccessToken(event.target.value)}
                />
              </label>

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
                <span>Ad Account ID</span>
                <input
                  type="text"
                  placeholder="438871067037500 o act_438871067037500"
                  value={mcpAdAccountId}
                  onChange={(event) => setMcpAdAccountId(event.target.value)}
                />
              </label>

              <label className="marketing-field">
                <span>Facebook Page ID (opcional)</span>
                <input
                  type="text"
                  placeholder="115406607722279"
                  value={mcpPageId}
                  onChange={(event) => setMcpPageId(event.target.value)}
                />
              </label>

              <div className="marketing-field marketing-field--full">
                <span>Zonas de la ciudad</span>
                <div className="marketing-zone-grid">
                  {zoneOptions.length === 0 ? (
                    <span className="marketing-zone-empty">Selecciona una ciudad para habilitar las zonas.</span>
                  ) : (
                    zoneOptions.map((zone) => {
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
                    })
                  )}
                </div>
              </div>
            </form>
            <p className="helper-text">
              Si dejas vacio el Page ID, el flujo intentara resolver la pagina automaticamente con el token antes de crear la campana.
            </p>

            <div className="marketing-generated-card">
              <div className="card-header">
                <span className="card-icon">&#129504;</span>
                <span className="card-title">Resumen Inteligente del Agente</span>
              </div>
              <div className="job-grid">
                <div className="job-item">
                  <span className="job-label">Pre-prompt aplicado</span>
                  <span className="job-value">{prePrompt || 'Escribe un pre-prompt y pasalo al resumen inteligente.'}</span>
                </div>
                <div className="job-item">
                  <span className="job-label">Prompt base</span>
                  <span className="job-value">{promptPreview || 'Completa el pre-prompt, ciudad y tipo de contacto.'}</span>
                </div>
                <div className="job-item">
                  <span className="job-label">Publico sugerido</span>
                  <span className="job-value">{audiencePreview}</span>
                </div>
                <div className="job-item">
                  <span className="job-label">Direccion visual</span>
                  <span className="job-value">{visualPreview}</span>
                </div>
                <div className="job-item">
                  <span className="job-label">Check zonas calientes</span>
                  <span className="job-value">{zoneIntelligencePreview}</span>
                </div>
                <div className="job-item">
                  <span className="job-label">Check segmentacion publico</span>
                  <span className="job-value">{audienceSegmentationPreview}</span>
                </div>
              </div>
            </div>

            <div className="marketing-generated-card">
              <div className="card-header">
                <span className="card-icon">&#9997;</span>
                <span className="card-title">Prompt Editable para los Agentes</span>
              </div>
              <label className="marketing-field marketing-field--full">
                <span>Prompt final</span>
                <textarea
                  className="marketing-prompt-textarea"
                  placeholder="Aqui aparecera el prompt generado para ads-analyst, image-creator y marketing..."
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
                <span className="helper-text">
                  Este texto es el que se enviara al orquestador. Puedes ajustarlo antes de ejecutar la campana.
                </span>
              </div>
            </div>
          </div>

          <div className="marketing-grid">
            <div className="marketing-execution">
              <div className="card-header">
                <span className="card-icon">&#9654;</span>
                <span className="card-title">Ejecucion del Agente</span>
              </div>
              <div className="marketing-execution__content">
                <div className="status-item">
                  <span className="status-item-label">Pre-prompt</span>
                  <span className="status-item-value">{prePrompt || 'Pendiente'}</span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Objetivo</span>
                  <span className="status-item-value">{selectedContactMode.objective}</span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Landing</span>
                  <span className="status-item-value">{contactMode === 'whatsapp' ? 'WhatsApp' : 'noyecode.com'}</span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Publico</span>
                  <span className="status-item-value">
                    {city
                      ? `${city}${selectedZones.length > 0 ? ` | ${selectedZones.join(', ')}` : ''}`
                      : 'Selecciona una ciudad'}
                  </span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Resumen</span>
                  <span className="status-item-value marketing-status-summary">{runSummary}</span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Checks</span>
                  <span className="status-item-value">
                    {[
                      useZoneIntelligence ? 'zonas calientes' : null,
                      useAudienceSegmentation ? 'segmentacion publico' : null,
                    ].filter(Boolean).join(' | ') || 'sin checks'}
                  </span>
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
                    <span className="job-label">Pre-prompt</span>
                    <span className="job-value">{preview.prePrompt || 'Sin pre-prompt'}</span>
                  </div>
                  <div className="job-item">
                    <span className="job-label">Concepto</span>
                    <span className="job-value">{preview.campaignIdea || 'Sin concepto'}</span>
                  </div>
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
                    <span className="job-label">Ciudad / zonas</span>
                    <span className="job-value">
                      {preview.city || 'Sin ciudad'}
                      {preview.zones && preview.zones.length > 0 ? ` | ${preview.zones.join(', ')}` : ''}
                    </span>
                  </div>
                  <div className="job-item">
                    <span className="job-label">Canal de contacto</span>
                    <span className="job-value">
                      {preview.contactMode === 'whatsapp' ? 'WhatsApp' : 'Contacto web'}
                    </span>
                  </div>
                  <div className="job-item">
                    <span className="job-label">Prompt enviado</span>
                    <span className="job-value">{preview.marketingPrompt || 'Sin prompt'}</span>
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
                  <div className="job-item">
                    <span className="job-label">Checks activos</span>
                    <span className="job-value">
                      {[
                        preview.zoneIntelligenceEnabled ? 'zonas calientes' : null,
                        preview.audienceSegmentationEnabled ? 'segmentacion de publico' : null,
                        preview.generateImageFromMarketingPrompt ? 'imagen automatica' : null,
                      ].filter(Boolean).join(' | ') || 'sin checks'}
                    </span>
                  </div>
                  <div className="job-item">
                    <span className="job-label">Estado imagen automatica</span>
                    <span className="job-value">
                      {preview.generatedImageStatus === 'generated'
                        ? 'Generada y aplicada'
                        : preview.generatedImageStatus === 'failed'
                          ? `Fallida${preview.generatedImageError ? `: ${preview.generatedImageError}` : ''}`
                          : preview.generatedImageStatus === 'busy'
                            ? `Ocupada${preview.generatedImageError ? `: ${preview.generatedImageError}` : ''}`
                            : preview.generatedImageStatus === 'pending'
                              ? 'Pendiente de generar'
                              : 'Desactivada'}
                    </span>
                  </div>
                </div>

                {preview.zoneInsights && (
                  <>
                    <div className="card-header" style={{ marginTop: 16 }}>
                      <span className="card-icon">&#128205;</span>
                      <span className="card-title">Zonas con Mayor Afinidad</span>
                    </div>
                    <div className="job-grid">
                      <div className="job-item">
                        <span className="job-label">Resumen</span>
                        <span className="job-value">{preview.zoneInsights.summary}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Search signals</span>
                        <span className="job-value">{preview.zoneInsights.searchSignals.join(' | ') || 'Sin señales'}</span>
                      </div>
                      {preview.zoneInsights.topZones.map((zone) => (
                        <div key={zone.zone} className="job-item">
                          <span className="job-label">{zone.zone}</span>
                          <span className="job-value">{zone.scoreLabel}</span>
                          <span className="job-value">{zone.reason}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {preview.audienceInsights && (
                  <>
                    <div className="card-header" style={{ marginTop: 16 }}>
                      <span className="card-icon">&#128101;</span>
                      <span className="card-title">Segmentacion de Publico</span>
                    </div>
                    <div className="job-grid">
                      <div className="job-item">
                        <span className="job-label">Resumen</span>
                        <span className="job-value">{preview.audienceInsights.summary}</span>
                      </div>
                      {preview.audienceInsights.segments.map((item) => (
                        <div key={item.label} className="job-item">
                          <span className="job-label">{item.label}</span>
                          <span className="job-value">{item.reason}</span>
                          <span className="job-value">Intereses: {item.interests.join(', ')}</span>
                          <span className="job-value">Senales: {item.intentSignals.join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

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
                        <span className="job-label">Ciudad / zonas</span>
                        <span className="job-value">
                          {preview.orchestrator.execution.city || 'Sin ciudad'}
                          {preview.orchestrator.execution.zones && preview.orchestrator.execution.zones.length > 0
                            ? ` | ${preview.orchestrator.execution.zones.join(', ')}`
                            : ''}
                        </span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Canal</span>
                        <span className="job-value">{preview.orchestrator.execution.contactChannel || 'Sin definir'}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Pre-prompt</span>
                        <span className="job-value">{preview.orchestrator.execution.prePrompt || 'Sin pre-prompt aplicado'}</span>
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
                        <span className="job-label">Zonas foco ads-analyst</span>
                        <span className="job-value">{preview.orchestrator.adsAnalyst.zoneFocus || 'Sin foco adicional'}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Segmentos ads-analyst</span>
                        <span className="job-value">{preview.orchestrator.adsAnalyst.audienceSegments?.join(' | ') || 'Sin segmentos sugeridos'}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">seo-analyzer</span>
                        <span className="job-value">{preview.orchestrator.seoAnalyzer?.zoneSummary || 'Sin analisis SEO local'}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Search intent</span>
                        <span className="job-value">{preview.orchestrator.seoAnalyzer?.searchIntent?.join(' | ') || 'Sin search intent'}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Content angles</span>
                        <span className="job-value">{preview.orchestrator.seoAnalyzer?.recommendedContentAngles?.join(' | ') || 'Sin angulos sugeridos'}</span>
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
                      {preview.generatedImagePrompt && (
                        <div className="job-item">
                          <span className="job-label">Prompt usado para generar la imagen</span>
                          <span className="job-value">{preview.generatedImagePrompt}</span>
                        </div>
                      )}
                      <div className="job-item">
                        <span className="job-label">marketing</span>
                        <span className="job-value">
                          {preview.orchestrator.marketing.verdict}. {preview.orchestrator.marketing.notes.join(' ')}
                        </span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Zonas recomendadas</span>
                        <span className="job-value">{preview.orchestrator.execution.recommendedZones?.join(' | ') || 'Sin zonas recomendadas'}</span>
                      </div>
                      <div className="job-item">
                        <span className="job-label">Publicos recomendados</span>
                        <span className="job-value">{preview.orchestrator.execution.audienceSegments?.join(' | ') || 'Sin publicos recomendados'}</span>
                      </div>
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
