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
import {
  generateDefaultPrompt,
  getEnvConfig,
  listFacebookPagePhotos,
  listCompanyRecords,
  onMarketingRunUpdate,
  runMarketingCampaignPreview,
  saveEnvConfig,
  startBot,
  stopBot,
} from './lib/commands'
import type { CompanyRecord, FacebookPagePhoto, MarketingRunUpdate, PromptHistoryEntry } from './lib/types'
import { IMAGE_FORMAT_GROUPS, NOYECODE_SERVICES } from './lib/types'

const CITY_ZONE_OPTIONS: Record<string, string[]> = {
  Bogota: ['Norte', 'Chapinero', 'Centro', 'Occidente', 'Sur', 'Suba', 'Usaquen'],
  Medellin: ['El Poblado', 'Laureles', 'Belen', 'Envigado', 'Sabaneta', 'Centro'],
  Cali: ['Norte', 'Sur', 'Oeste', 'Centro', 'Jamundi'],
  Barranquilla: ['Norte', 'Centro', 'Riomar', 'Soledad'],
  Cartagena: ['Bocagrande', 'Centro', 'Manga', 'Zona Norte'],
  Bucaramanga: ['Cabecera', 'Centro', 'Cacique', 'Floridablanca'],
}

const CONTACT_MODE_OPTIONS = [
  {
    value: 'lead_form' as const,
    label: 'Formulario de clientes potenciales',
    objective: 'Clientes potenciales',
  },
  {
    value: 'whatsapp' as const,
    label: 'Contactarme por WhatsApp',
    objective: 'Mensajes / WhatsApp',
  },
]

function buildMarketingPromptPreview(params: {
  campaignIdea: string
  city: string
  zones: string[]
  contactMode: 'lead_form' | 'whatsapp'
  budget: string
  startDate: string
  endDate: string
}) {
  const campaignIdea = params.campaignIdea.trim()
  const city = params.city.trim()
  const zonesLabel = params.zones.length > 0 ? params.zones.join(', ') : 'toda la ciudad'
  const contactLabel = params.contactMode === 'whatsapp'
    ? 'generar conversaciones por WhatsApp'
    : 'captar clientes potenciales con formulario'
  const objectiveLabel = params.contactMode === 'whatsapp' ? 'Mensajes / WhatsApp' : 'Clientes potenciales'
  const budgetLabel = params.budget.trim() || 'pendiente'
  const dateLabel = params.startDate && params.endDate
    ? `${params.startDate} -> ${params.endDate}`
    : 'pendiente'

  if (!campaignIdea || !city) return ''

  return [
    `Quiero una campana de Facebook Ads para "${campaignIdea}".`,
    `Ciudad objetivo: ${city}.`,
    `Zonas prioritarias: ${zonesLabel}.`,
    `Objetivo principal: ${objectiveLabel}.`,
    `Canal de contacto: ${contactLabel}.`,
    `Presupuesto estimado: ${budgetLabel}.`,
    `Fechas de campana: ${dateLabel}.`,
    'Genera un brief completo usando el ads-analyst, image-creator y marketing con esta estructura:',
    '1. copy sugerido del anuncio',
    '2. publico recomendado',
    '3. hook principal',
    '4. CTA recomendado',
    '5. direccion visual de la imagen',
    '6. recomendacion de segmentacion local',
    `La imagen debe estar directamente relacionada con "${campaignIdea}" y sentirse coherente con ${city}.`,
  ].join('\n')
}

function MarketingCampaignModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [campaignIdea, setCampaignIdea] = useState('')
  const [city, setCity] = useState('')
  const [selectedZones, setSelectedZones] = useState<string[]>([])
  const [contactMode, setContactMode] = useState<'lead_form' | 'whatsapp'>('lead_form')
  const [marketingPrompt, setMarketingPrompt] = useState('')
  const [promptEdited, setPromptEdited] = useState(false)
  const [budget, setBudget] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [mcpAccessToken, setMcpAccessToken] = useState('')
  const [mcpPageAccessToken, setMcpPageAccessToken] = useState('')
  const [mcpPageId, setMcpPageId] = useState('')
  const [mcpAdAccountId, setMcpAdAccountId] = useState('')
  const [facebookPhotos, setFacebookPhotos] = useState<FacebookPagePhoto[]>([])
  const [facebookPhotosLoading, setFacebookPhotosLoading] = useState(false)
  const [facebookPhotosError, setFacebookPhotosError] = useState('')
  const [selectedFacebookPhotoId, setSelectedFacebookPhotoId] = useState('')
  const [runState, setRunState] = useState<'idle' | 'running' | 'success' | 'warning' | 'error'>('idle')
  const [runSummary, setRunSummary] = useState('Completa el formulario para ejecutar el agente.')
  const [runLines, setRunLines] = useState<string[]>([])
  const [preview, setPreview] = useState<MarketingRunUpdate['preview'] | null>(null)
  const zoneOptions = city ? (CITY_ZONE_OPTIONS[city] || []) : []
  const selectedContactMode = CONTACT_MODE_OPTIONS.find((option) => option.value === contactMode) || CONTACT_MODE_OPTIONS[0]

  const validationMessage = useMemo(() => {
    if (!campaignIdea || !city) return 'Completa el concepto de la campana y la ciudad objetivo.'
    if (!budget || !startDate || !endDate) return 'Completa presupuesto y fechas para continuar.'
    if (!mcpAccessToken || !mcpAdAccountId) return 'Completa las credenciales principales del MCP Meta Ads.'
    if (Number(budget) <= 0) return 'El presupuesto debe ser mayor a 0.'
    if (endDate < startDate) return 'La fecha de fin no puede ser menor que la fecha de inicio.'
    return 'Formulario listo para continuar a la vista previa de la campaña.'
  }, [budget, campaignIdea, city, endDate, mcpAccessToken, mcpAdAccountId, startDate])

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

  const audiencePreview = useMemo(() => {
    if (!campaignIdea || !city) return 'Completa el concepto y la ciudad para ver el publico sugerido.'
    const zonesLabel = selectedZones.length > 0 ? selectedZones.join(', ') : 'cobertura general de la ciudad'
    if (/veterinari|mascota|pet/i.test(campaignIdea)) {
      return `Duenos de mascotas en ${city}, zonas ${zonesLabel}, 24-55 anos, interesados en bienestar animal, vacunas, grooming y atencion veterinaria.`
    }
    return `Personas en ${city}, zonas ${zonesLabel}, con interes o necesidad relacionada con ${campaignIdea}, 24-55 anos, con intencion de contacto o compra.`
  }, [campaignIdea, city, selectedZones])

  const visualPreview = useMemo(() => {
    if (!campaignIdea || !city) return 'La direccion visual aparecera cuando completes el concepto de la campana.'
    const contactContext = contactMode === 'whatsapp'
      ? 'con enfoque cercano, conversacional y listo para escribir por WhatsApp'
      : 'con enfoque de captacion y llamada clara al formulario'
    return `Imagen de Facebook Ads relacionada con "${campaignIdea}" en ${city}, ${contactContext}, composicion limpia, foco en el beneficio principal y contexto visual coherente con el negocio.`
  }, [campaignIdea, city, contactMode])

  useEffect(() => {
    setSelectedZones((current) => current.filter((zone) => zoneOptions.includes(zone)))
  }, [zoneOptions])

  useEffect(() => {
    if (!promptEdited) {
      setMarketingPrompt(promptPreview)
    }
  }, [promptEdited, promptPreview])

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

  const handleLoadFacebookPhotos = async () => {
    setFacebookPhotosLoading(true)
    setFacebookPhotosError('')
    try {
      const photos = await listFacebookPagePhotos({
        pageId: mcpPageId.trim(),
        accessToken: mcpAccessToken.trim(),
        pageAccessToken: mcpPageAccessToken.trim(),
        limit: 10,
      })
      setFacebookPhotos(photos)
      setSelectedFacebookPhotoId((current) => {
        if (current && photos.some((photo) => photo.id === current)) return current
        return photos[0]?.id || ''
      })
    } catch (error) {
      setFacebookPhotos([])
      setSelectedFacebookPhotoId('')
      setFacebookPhotosError(error instanceof Error ? error.message : 'No se pudieron cargar las fotos de Facebook.')
    } finally {
      setFacebookPhotosLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    if (!mcpPageId.trim() && !mcpAccessToken.trim() && !mcpPageAccessToken.trim()) {
      setFacebookPhotos([])
      setSelectedFacebookPhotoId('')
      setFacebookPhotosError('')
      setFacebookPhotosLoading(false)
      return
    }
    void handleLoadFacebookPhotos()
  }, [mcpAccessToken, mcpPageAccessToken, mcpPageId, open])

  const selectedFacebookPhoto = facebookPhotos.find((photo) => photo.id === selectedFacebookPhotoId) || null

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
    !!campaignIdea &&
    !!city &&
    !!budget &&
    !!startDate &&
    !!endDate &&
    !!mcpAccessToken &&
    !!mcpAdAccountId &&
    Number(budget) > 0 &&
    endDate >= startDate &&
    runState !== 'running'

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
        city,
        zones: selectedZones,
        contactMode,
        marketingPrompt,
        budget,
        startDate,
        endDate,
        facebookPhotoUrl: selectedFacebookPhoto?.imageUrl || selectedFacebookPhoto?.picture || '',
        facebookPhotoId: selectedFacebookPhoto?.id || '',
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
              <p>jhordan, aqui ya puedes bajar una idea como "Campana veterinaria" y convertirla en brief listo para copy, publico, zonas y creativo.</p>
              <ol className="marketing-copy__list">
                <li>Concepto o frase base de la campana.</li>
                <li>Ciudad y zonas donde quieres pautar.</li>
                <li>Si quieres formulario de leads o contacto por WhatsApp.</li>
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
              <label className="marketing-field">
                <span>Concepto de campana</span>
                <input
                  type="text"
                  placeholder="Ej. Campana veterinaria"
                  value={campaignIdea}
                  onChange={(event) => setCampaignIdea(event.target.value)}
                />
              </label>

              <label className="marketing-field">
                <span>Ciudad objetivo</span>
                <select value={city} onChange={(event) => setCity(event.target.value)}>
                  <option value="">Selecciona una ciudad</option>
                  {Object.keys(CITY_ZONE_OPTIONS).map((cityOption) => (
                    <option key={cityOption} value={cityOption}>
                      {cityOption}
                    </option>
                  ))}
                </select>
              </label>

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
                <span className="card-icon">&#128247;</span>
                <span className="card-title">Fotos de la Pagina de Facebook</span>
              </div>
              <label className="marketing-field marketing-field--full">
                <span>Ultimas imagenes publicadas en la pagina</span>
                <select
                  value={selectedFacebookPhotoId}
                  onChange={(event) => setSelectedFacebookPhotoId(event.target.value)}
                  disabled={facebookPhotosLoading || facebookPhotos.length === 0}
                >
                  {facebookPhotos.length === 0 ? (
                    <option value="">
                      {facebookPhotosLoading ? 'Cargando fotos de la pagina...' : 'No se encontraron fotos en la pagina'}
                    </option>
                  ) : (
                    facebookPhotos.map((photo) => (
                      <option key={photo.id} value={photo.id}>
                        {photo.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <div className="marketing-prompt-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => void handleLoadFacebookPhotos()}
                  disabled={facebookPhotosLoading}
                >
                  {facebookPhotosLoading ? 'Cargando...' : 'Recargar fotos'}
                </button>
                <span className="helper-text">
                  Este selector mezcla fotos subidas y publicaciones con imagen, excluye videos y ordena las 10 mas recientes de la pagina de Noyecode.
                </span>
              </div>
              {facebookPhotosError && (
                <p className="helper-text" style={{ color: '#fca5a5' }}>
                  {facebookPhotosError}
                </p>
              )}
              {selectedFacebookPhoto && (
                <div className="marketing-facebook-photo-preview">
                  <img
                    src={selectedFacebookPhoto.imageUrl || selectedFacebookPhoto.picture}
                    alt={selectedFacebookPhoto.name}
                    className="marketing-facebook-photo-preview__image"
                  />
                  <div className="marketing-facebook-photo-preview__meta">
                    <span className="job-label">Seleccionada</span>
                    <span className="job-value">{selectedFacebookPhoto.name}</span>
                    <span className="job-value">{selectedFacebookPhoto.createdTime || selectedFacebookPhoto.id}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="marketing-generated-card">
              <div className="card-header">
                <span className="card-icon">&#129504;</span>
                <span className="card-title">Resumen Inteligente del Agente</span>
              </div>
              <div className="job-grid">
                <div className="job-item">
                  <span className="job-label">Prompt base</span>
                  <span className="job-value">{promptPreview || 'Completa el concepto, ciudad y tipo de contacto.'}</span>
                </div>
                <div className="job-item">
                  <span className="job-label">Publico sugerido</span>
                  <span className="job-value">{audiencePreview}</span>
                </div>
                <div className="job-item">
                  <span className="job-label">Direccion visual</span>
                  <span className="job-value">{visualPreview}</span>
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
                  <span className="status-item-label">Concepto</span>
                  <span className="status-item-value">{campaignIdea || 'Pendiente'}</span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Objetivo</span>
                  <span className="status-item-value">{selectedContactMode.objective}</span>
                </div>
                <div className="status-item">
                  <span className="status-item-label">Landing</span>
                  <span className="status-item-value">{contactMode === 'whatsapp' ? 'WhatsApp' : 'noyecode.com + Instant Form'}</span>
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
                      {preview.contactMode === 'whatsapp' ? 'WhatsApp' : 'Formulario instantaneo'}
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
  const [brandName, setBrandName] = useState('NoyeCode')
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null)
  const [page, setPage] = useState<'home' | 'companies' | 'settings'>('home')
  const [marketingOpen, setMarketingOpen] = useState(false)
  const [botLoading, setBotLoading] = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')
  const [imagePromptHistory, setImagePromptHistory] = useState<PromptHistoryEntry[]>([])
  const [imageFormat, setImageFormat] = useState(() =>
    window.localStorage.getItem('imageFormat') || 'fb-vertical'
  )
  const [imageService, setImageService] = useState(() =>
    window.localStorage.getItem('imageService') || NOYECODE_SERVICES[0].value
  )
  const [lastUsedService, setLastUsedService] = useState(() =>
    window.localStorage.getItem('lastUsedService') || ''
  )
  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [selectedCompany, setSelectedCompany] = useState('')
  const [publishPlatforms, setPublishPlatforms] = useState<Record<string, boolean>>({})
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
    listCompanyRecords()
      .then((records) => {
        if (cancelled) return
        setCompanies(records)
      })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const activeCompanies = companies.filter((company) => company.activo)
    if (activeCompanies.length === 0) {
      if (selectedCompany) {
        setSelectedCompany('')
      }
      return
    }
    if (activeCompanies.some((company) => company.nombre === selectedCompany)) {
      return
    }
    const saved = window.localStorage.getItem('selectedCompany') || ''
    const fallback = activeCompanies.find((company) => company.nombre === saved) || activeCompanies[0]
    setSelectedCompany(fallback.nombre)
    const platforms: Record<string, boolean> = {}
    fallback.platforms.forEach((p) => { platforms[p.platform] = true })
    setPublishPlatforms(platforms)
    try {
      window.localStorage.setItem('selectedCompany', fallback.nombre)
    } catch { /* ignore */ }
  }, [companies, selectedCompany])

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

  const handleChangeService = (value: string) => {
    setImageService(value)
    try {
      window.localStorage.setItem('imageService', value)
    } catch { /* ignore */ }
  }

  const handleChangeCompany = (value: string) => {
    setSelectedCompany(value)
    try {
      window.localStorage.setItem('selectedCompany', value)
    } catch { /* ignore */ }
    const company = companies.find((c) => c.nombre === value)
    if (company) {
      const platforms: Record<string, boolean> = {}
      company.platforms.forEach((p) => { platforms[p.platform] = true })
      setPublishPlatforms(platforms)
    }
  }

  const handleTogglePlatform = (platform: string) => {
    setPublishPlatforms((prev) => ({ ...prev, [platform]: !prev[platform] }))
  }

  const promptCompanies = companies.filter((company) => company.activo)
  const activeCompany = promptCompanies.find((c) => c.nombre === selectedCompany) || null
  const hasCompany = promptCompanies.length > 0
  const enabledPlatforms = Object.entries(publishPlatforms).filter(([, v]) => v).map(([k]) => k)

  const isExecuting = botStatus.status === 'executing'

  const handleStartPoller = async () => {
    if (poller.running || poller.loading) return
    const prompt = imagePrompt.trim()
    if (!prompt) return
    rememberPrompt(prompt)
    setLastUsedService(imageService)
    try { window.localStorage.setItem('lastUsedService', imageService) } catch { /* ignore */ }
    await poller.start({ imagePrompt: prompt, imageFormat, imageService, companyName: selectedCompany })
  }

  const handleStartBot = async () => {
    if (isExecuting || botLoading) return
    const prompt = imagePrompt.trim()
    if (!prompt) return
    setBotLoading(true)
    try {
      rememberPrompt(prompt)
      setLastUsedService(imageService)
      try { window.localStorage.setItem('lastUsedService', imageService) } catch { /* ignore */ }
      await startBot({ imagePrompt: prompt, imageFormat, imageService, companyName: selectedCompany })
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

  const applyBrandFromCompanies = (companies: CompanyRecord[]) => {
    const ordered = [...companies].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    const preferred = ordered.find((company) => company.logo_url) || ordered[0]
    if (!preferred) {
      setBrandName('NoyeCode')
      setBrandLogoUrl(null)
      return
    }
    setBrandName(preferred.nombre || 'NoyeCode')
    setBrandLogoUrl(preferred.logo_url || null)
  }

  const refreshBrand = async () => {
    try {
      const companies = await listCompanyRecords()
      setCompanies(companies)
      applyBrandFromCompanies(companies)
    } catch {
      setCompanies([])
      setBrandName('NoyeCode')
      setBrandLogoUrl(null)
    }
  }

  useEffect(() => {
    void refreshBrand()
  }, [])

  return (
    <div className="app">
      <Header
        status={botStatus}
        brandName={brandName}
        brandLogoUrl={brandLogoUrl}
        onOpenSettings={() => setPage('settings')}
      />
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
              hasCompany={hasCompany}
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
            companies={promptCompanies}
            selectedCompany={selectedCompany}
            onChangeCompany={handleChangeCompany}
            publishPlatforms={publishPlatforms}
            onTogglePlatform={handleTogglePlatform}
            imageService={imageService}
            onChangeImageService={handleChangeService}
            lastUsedService={lastUsedService}
            imageFormat={imageFormat}
            onChangeImageFormat={handleChangeFormat}
            promptDisabled={isExecuting || botLoading}
          />
        </>
      )}

      {page === 'companies' && <CompanyProfilesPage onCompaniesChanged={() => void refreshBrand()} />}

      {page === 'settings' && <SettingsPage brandName={brandName} brandLogoUrl={brandLogoUrl} />}
      <MarketingCampaignModal open={marketingOpen} onClose={() => setMarketingOpen(false)} />
    </div>
  )
}
