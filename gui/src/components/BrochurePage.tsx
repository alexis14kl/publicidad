import { useEffect, useRef, useState } from 'react'
import { listCompanyRecords } from '../shared/api/commands'
import { DEFAULT_BRAND_COLORS, type CompanyRecord } from '../shared/api/types'

type ColorKey = keyof typeof DEFAULT_BRAND_COLORS

const COLOR_LABELS: { key: ColorKey; label: string }[] = [
  { key: 'color_primario', label: 'Primario' },
  { key: 'color_cta', label: 'CTA' },
  { key: 'color_acento', label: 'Acento' },
  { key: 'color_checks', label: 'Checks' },
  { key: 'color_fondo', label: 'Fondo' },
]

export function BrochurePage({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState('')
  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [selectedCompany, setSelectedCompany] = useState('')

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
              disabled={!prompt.trim() || !company}
              onClick={() => {
                /* TODO: IPC generate-brochure */
              }}
            >
              Generar Brochure
            </button>
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
