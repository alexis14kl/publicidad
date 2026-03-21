import { useEffect, useRef, useState } from 'react'
import { useBotLogTail } from '../hooks/useBotLogTail'
import { listCompanyRecords, startBot } from '../shared/api/commands'
import { DEFAULT_BRAND_COLORS, type CompanyRecord } from '../shared/api/types'

type ColorKey = keyof typeof DEFAULT_BRAND_COLORS

const COLOR_LABELS: { key: ColorKey; label: string }[] = [
  { key: 'color_primario', label: 'Primario' },
  { key: 'color_cta', label: 'CTA' },
  { key: 'color_acento', label: 'Acento' },
  { key: 'color_checks', label: 'Checks' },
  { key: 'color_fondo', label: 'Fondo' },
]

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

function colorize(line: string): { text: string; className: string } {
  if (line.includes('[OK]') || line.includes('[ok]')) return { text: line, className: 'log-ok' }
  if (line.includes('[ERROR]') || line.includes('[error]') || line.includes('ERROR')) return { text: line, className: 'log-error' }
  if (line.includes('[WARN]') || line.includes('[warn]') || line.includes('WARNING')) return { text: line, className: 'log-warn' }
  if (line.includes('[INFO]') || line.includes('[info]')) return { text: line, className: 'log-info' }
  if (/^\[?\d+\/\d+\]/.test(line.trim())) return { text: line, className: 'log-step' }
  return { text: line, className: '' }
}

export function BrochurePage({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState('')
  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [selectedCompany, setSelectedCompany] = useState('')

  const [generating, setGenerating] = useState(false)
  const { lines: botLines, clearLines: clearBotLines } = useBotLogTail()
  const logRef = useRef<HTMLDivElement>(null)

  // Overrides locales para este brochure (no afectan la empresa)
  const [customLogo, setCustomLogo] = useState<{ url: string; name: string } | null>(null)
  const [customColors, setCustomColors] = useState<Record<string, string>>({})
  const logoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listCompanyRecords()
      .then((records) => {
        const active = records.filter((c) => c.activo)
        setCompanies(active)
        if (active.length > 0 && !selectedCompany) {
          setSelectedCompany(active[0].nombre)
        }
      })
      .catch(() => { /* ignore */ })
  }, [])

  // Auto-scroll logs + detectar fin del bot
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
    // Detectar si el bot termino
    const lastLine = botLines[botLines.length - 1] || ''
    if (generating && lastLine.includes('Bot finalizo con codigo')) {
      setGenerating(false)
      if (lastLine.includes('codigo: 0')) {
        setStatusMsg('Brochure generado con exito. Revisa brochures_generados/')
      } else {
        setStatusMsg('El bot termino con errores. Revisa la consola.')
      }
    }
  }, [botLines, generating])

  const company = companies.find((c) => c.nombre === selectedCompany) || null

  // Reset overrides cuando cambia la empresa
  useEffect(() => {
    setCustomLogo(null)
    setCustomColors({})
  }, [selectedCompany])

  const getColor = (key: ColorKey): string => {
    if (customColors[key]) return customColors[key]
    if (company?.[key]) return company[key] as string
    return DEFAULT_BRAND_COLORS[key]
  }

  const handleColorChange = (key: ColorKey, value: string) => {
    setCustomColors((prev) => ({ ...prev, [key]: value }))
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setCustomLogo({ url, name: file.name })
  }

  const [statusMsg, setStatusMsg] = useState('')

  const handleGenerate = async () => {
    if (!prompt.trim() || !company || generating) return
    setGenerating(true)
    setStatusMsg('Iniciando generacion de brochure...')
    clearBotLines()
    try {
      const brochureCustomColors = Object.keys(customColors).length > 0 ? customColors : undefined
      const result = await startBot({
        imagePrompt: prompt.trim(),
        companyName: company.nombre,
        contentType: 'brochure',
        brochureCustomColors,
      } as any)
      if (result.success) {
        setStatusMsg(`Bot iniciado (PID: ${result.pid}). Revisa la consola...`)
      } else {
        setStatusMsg(`Error: ${result.error || 'No se pudo iniciar el bot'}`)
        setGenerating(false)
      }
    } catch (err) {
      setStatusMsg(`Error: ${err instanceof Error ? err.message : String(err)}`)
      setGenerating(false)
    }
  }

  const logoUrl = customLogo?.url || company?.logo_url || null
  const logoLabel = customLogo?.name || company?.nombre || ''

  return (
    <div className="brochure-page">
      <div className="brochure-page__header">
        <div>
          <span className="brochure-page__eyebrow">Modulo Brochure</span>
          <h2 className="brochure-page__title">Generador de Brochures</h2>
        </div>
        <button className="btn btn--ghost" onClick={onClose}>Volver al Panel</button>
      </div>

      {/* ── Barra de empresa: logo + colores + datos ── */}
      <div className="brochure-company-bar glass-card">
        {companies.length > 1 && (
          <div className="brochure-company-bar__selector">
            <label className="format-select__label">Empresa</label>
            <select
              className="format-select__input"
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.nombre}>{c.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {company && (
          <>
            {/* Logo editable */}
            <div className="brochure-company-bar__logo">
              <button
                className="brochure-company-bar__logo-btn"
                onClick={() => logoInputRef.current?.click()}
                title="Click para cambiar logo del brochure"
              >
                {logoUrl ? (
                  <img src={logoUrl} alt={logoLabel} className="brochure-company-bar__logo-img" />
                ) : (
                  <div className="brochure-company-bar__logo-placeholder">
                    {company.nombre.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="brochure-company-bar__logo-edit">Cambiar</span>
              </button>
              <input
                ref={logoInputRef}
                type="file"
                accept=".svg,.png,.jpg,.jpeg,.webp"
                onChange={handleLogoUpload}
                style={{ display: 'none' }}
              />
              <div className="brochure-company-bar__logo-info">
                <span className="brochure-company-bar__name">{company.nombre}</span>
                {customLogo && (
                  <span className="brochure-company-bar__custom-badge">Logo personalizado</span>
                )}
              </div>
            </div>

            {/* Colores editables */}
            <div className="brochure-company-bar__colors">
              {COLOR_LABELS.map(({ key, label }) => {
                const color = getColor(key)
                const isCustom = !!customColors[key]
                return (
                  <label key={key} className={`brochure-color-swatch ${isCustom ? 'brochure-color-swatch--custom' : ''}`} title={`${label}: ${color} (click para cambiar)`}>
                    <input
                      type="color"
                      className="brochure-color-swatch__picker"
                      value={color}
                      onChange={(e) => handleColorChange(key, e.target.value)}
                    />
                    <span className="brochure-color-swatch__circle" style={{ background: color }} />
                    <span className="brochure-color-swatch__label">{label}</span>
                  </label>
                )
              })}
            </div>

            {/* Datos de contacto */}
            <div className="brochure-company-bar__contact">
              {company.telefono && <span>{company.telefono}</span>}
              {company.correo && <span>{company.correo}</span>}
              {company.sitio_web && <span>{company.sitio_web}</span>}
            </div>
          </>
        )}

        {!company && (
          <p className="brochure-company-bar__empty">No hay empresas activas. Crea una en la seccion Empresas.</p>
        )}
      </div>

      {Object.keys(customColors).length > 0 && (
        <button className="brochure-page__reset-colors" onClick={() => setCustomColors({})}>
          Restaurar colores de la empresa
        </button>
      )}

      <p className="brochure-page__subtitle">
        Describe el brochure que necesitas y ChatGPT generara el diseno. El bot inyecta el logo y datos de tu empresa automaticamente.
      </p>

      {/* ── Builder + Preview ── */}
      <div className="brochure-page__body">
        <div className="brochure-page__builder">
          <div className="brochure-page__prompt-section">
            <label className="format-select__label">Describe tu brochure</label>
            <textarea
              className="brochure-page__textarea"
              placeholder="Ej: Brochure profesional para servicios de desarrollo de software, estilo corporativo moderno, doble cara..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
            />
          </div>

          <div className="brochure-page__actions">
            <button
              className="btn btn--brochure"
              disabled={!prompt.trim() || !company || generating}
              onClick={handleGenerate}
            >
              {generating ? 'Generando...' : 'Generar Brochure'}
            </button>
          </div>

          {statusMsg && (
            <div className={`brochure-page__status ${statusMsg.startsWith('Error') ? 'brochure-page__status--error' : ''}`}>
              {statusMsg}
            </div>
          )}

          {/* ── Consola de logs del bot ── */}
          <div className="brochure-page__console glass-card">
            <div className="log-header">
              <div className="card-header">
                <span className="card-icon">&#9654;</span>
                <span className="card-title">Consola Brochure</span>
                <span className="log-count">{botLines.length} lineas</span>
              </div>
              <button className="btn btn--small btn--ghost" onClick={clearBotLines}>
                Limpiar
              </button>
            </div>
            <div ref={logRef} className="brochure-page__console-content">
              {botLines.length === 0 ? (
                <p className="no-data">Los logs del bot apareceran aqui al generar un brochure</p>
              ) : (
                botLines.map((line, i) => {
                  const { text, className } = colorize(stripAnsi(line))
                  return (
                    <div key={i} className={`log-line ${className}`}>{text}</div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        <div className="brochure-page__preview">
          <div className="brochure-page__preview-placeholder">
            <span className="brochure-page__preview-icon">PDF</span>
            <p>El preview del brochure aparecera aqui</p>
          </div>
        </div>
      </div>
    </div>
  )
}
