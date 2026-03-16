import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { deleteCompanyRecord, listCompanyRecords, saveCompanyRecord, selectCompanyLogoSvg } from '../lib/commands'
import type { CompanyPlatform, CompanyRecord, SaveCompanyPayload } from '../lib/types'

const PLATFORM_OPTIONS: { key: CompanyPlatform; label: string; dbFile: string }[] = [
  { key: 'facebook', label: 'Facebook', dbFile: 'facebook.sqlite3' },
  { key: 'tiktok', label: 'TikTok', dbFile: 'tiktok.sqlite3' },
  { key: 'linkedin', label: 'LinkedIn', dbFile: 'linkedin.sqlite3' },
  { key: 'instagram', label: 'Instagram', dbFile: 'instagram.sqlite3' },
]

const EMPTY_FORM = {
  nombre: '',
  token: '',
  logo: '',
  telefono: '',
  correo: '',
  sitio_web: '',
  direccion: '',
  descripcion: '',
  activo: true,
  syncToConfig: true,
}

type FormState = typeof EMPTY_FORM

export function CompanyProfilesPage() {
  const [platform, setPlatform] = useState<CompanyPlatform>('facebook')
  const [records, setRecords] = useState<CompanyRecord[]>([])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null)
  const [logoFileName, setLogoFileName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingEmpresaId, setDeletingEmpresaId] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentPlatform = PLATFORM_OPTIONS.find((option) => option.key === platform) ?? PLATFORM_OPTIONS[0]
  const tokenConfigKey =
    {
      facebook: 'FB_ACCESS_TOKEN',
      instagram: 'INSTAGRAM_ACCESS_TOKEN',
      linkedin: 'LINKEDIN_ACCESS_TOKEN',
      tiktok: 'TIKTOK_ACCESS_TOKEN',
    }[platform] ?? 'ACCESS_TOKEN'

  const maskToken = (value: string) => {
    const clean = value.trim()
    if (!clean) return 'Sin token'
    if (clean.length <= 10) return clean
    return `${clean.slice(0, 6)}...${clean.slice(-4)}`
  }

  const formatLogoLabel = (value: string | null | undefined) => {
    const raw = String(value || '').trim()
    if (!raw) return 'Sin logo'
    const parts = raw.split('/')
    return parts[parts.length - 1] || raw
  }

  const validationMessage = useMemo(() => {
    if (!form.nombre.trim()) return 'Completa el nombre de la empresa.'
    if (!form.token.trim()) return 'Completa el token o credencial principal.'
    if (!form.correo.trim() && !form.telefono.trim()) return 'Agrega al menos un correo o un telefono de contacto.'
    return 'Formulario listo para guardar en la base de datos de la plataforma seleccionada.'
  }, [form])

  const canSave =
    !!form.nombre.trim() &&
    !!form.token.trim() &&
    (!!form.correo.trim() || !!form.telefono.trim()) &&
    !saving

  const loadRecords = async (targetPlatform: CompanyPlatform) => {
    setLoading(true)
    setError(null)
    try {
      const nextRecords = await listCompanyRecords(targetPlatform)
      setRecords(nextRecords)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los registros.')
      setRecords([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRecords(platform)
  }, [platform])

  const handleFieldChange = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setMessage(null)
    setError(null)
  }

  const handleSelectLogo = async () => {
    setMessage(null)
    setError(null)

    try {
      const result = await selectCompanyLogoSvg()
      if (result.canceled) return
      if (!result.success || !result.logoPath) {
        throw new Error(result.error || 'No se pudo cargar el logo SVG.')
      }
      setForm((prev) => ({ ...prev, logo: result.logoPath || '' }))
      setLogoFileName(result.logoName || formatLogoLabel(result.logoPath))
      setLogoPreviewUrl(result.logoUrl || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el logo SVG.')
    }
  }

  const handleClearLogo = () => {
    setForm((prev) => ({ ...prev, logo: '' }))
    setLogoFileName('')
    setLogoPreviewUrl(null)
    setMessage(null)
    setError(null)
  }

  const handleDeleteRecord = async (record: CompanyRecord) => {
    const empresaId = record.empresa_id ?? record.id
    if (!empresaId) return

    const confirmed = window.confirm(`Se eliminara la empresa "${record.nombre}" de ${currentPlatform.label}. Continuar?`)
    if (!confirmed) return

    setDeletingEmpresaId(empresaId)
    setMessage(null)
    setError(null)

    try {
      const result = await deleteCompanyRecord({
        platform,
        empresaId,
      })
      if (!result.success) {
        throw new Error('No se pudo eliminar la empresa.')
      }
      setMessage(`Empresa eliminada de ${currentPlatform.label}: ${result.deletedName || record.nombre}`)
      await loadRecords(platform)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la empresa.')
    } finally {
      setDeletingEmpresaId(null)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSave) return

    setSaving(true)
    setMessage(null)
    setError(null)

    try {
      const payload: SaveCompanyPayload = {
        platform,
        nombre: form.nombre.trim(),
        token: form.token.trim(),
        logo: form.logo.trim(),
        telefono: form.telefono.trim(),
        correo: form.correo.trim(),
        sitio_web: form.sitio_web.trim(),
        direccion: form.direccion.trim(),
        descripcion: form.descripcion.trim(),
        activo: form.activo,
        syncToConfig: form.syncToConfig,
      }
      const savedRecord = await saveCompanyRecord(payload)
      const syncMessage =
        savedRecord.config_synced && savedRecord.config_env_key
          ? ` Token sincronizado en ${savedRecord.config_env_key}.`
          : ''
      setMessage(`Empresa guardada en ${currentPlatform.label}: ${savedRecord.nombre}.${syncMessage}`)
      setForm(EMPTY_FORM)
      setLogoFileName('')
      setLogoPreviewUrl(null)
      await loadRecords(platform)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la empresa.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="company-page">
      <section className="company-hero glass-card">
        <div>
          <p className="company-hero__eyebrow">Empresas por plataforma</p>
          <h2 className="company-hero__title">Formulario maestro para credenciales y datos comerciales</h2>
          <p className="company-hero__text">
            Cada tab guarda el token en su tabla de red social y mantiene los datos generales de la empresa en la
            tabla central <strong>empresas</strong>. La relacion operativa se resuelve por el nombre de la empresa
            para que puedas reutilizar la misma ficha comercial entre plataformas.
          </p>
        </div>
        <div className="company-hero__meta">
          <span className="company-chip">{currentPlatform.label}</span>
          <span className="company-chip company-chip--dim">{currentPlatform.dbFile}</span>
          <span className="company-chip company-chip--dim">{tokenConfigKey}</span>
        </div>
      </section>

      <div className="company-platform-tabs">
        {PLATFORM_OPTIONS.map((option) => (
          <button
            key={option.key}
            className={`company-platform-tab ${option.key === platform ? 'company-platform-tab--active' : ''}`}
            onClick={() => setPlatform(option.key)}
          >
            <span>{option.label}</span>
            <small>{option.dbFile}</small>
          </button>
        ))}
      </div>

      <div className="company-layout">
        <section className="company-form-card glass-card">
          <div className="card-header">
            <span className="card-icon">&#128221;</span>
            <span className="card-title">Formulario de Empresa</span>
          </div>

          <form className="company-form" onSubmit={handleSubmit}>
            <label className="company-field">
              <span>Nombre de la empresa</span>
              <input
                value={form.nombre}
                onChange={(event) => handleFieldChange('nombre', event.target.value)}
                placeholder="Ej. NoyeCode SAS"
              />
            </label>

            <label className="company-field">
              <span>Token / credencial</span>
              <input
                value={form.token}
                onChange={(event) => handleFieldChange('token', event.target.value)}
                placeholder="Ej. EAAB... o token interno"
              />
            </label>

            <label className="company-field">
              <span>Logo</span>
              <div className="company-logo-picker">
                <div className="company-logo-picker__actions">
                  <button className="btn btn--ghost btn--small" type="button" onClick={handleSelectLogo}>
                    Cargar SVG
                  </button>
                  <button
                    className="btn btn--ghost btn--small"
                    type="button"
                    onClick={handleClearLogo}
                    disabled={!form.logo}
                  >
                    Quitar
                  </button>
                </div>
                <div className="company-logo-picker__meta">
                  <strong>{logoFileName || formatLogoLabel(form.logo) || 'Sin logo seleccionado'}</strong>
                  <span>Solo se permiten archivos en formato .svg</span>
                </div>
                {logoPreviewUrl && (
                  <div className="company-logo-picker__preview">
                    <img src={logoPreviewUrl} alt="Preview del logo" />
                  </div>
                )}
              </div>
            </label>

            <label className="company-field">
              <span>Telefono</span>
              <input
                value={form.telefono}
                onChange={(event) => handleFieldChange('telefono', event.target.value)}
                placeholder="+57 300 000 0000"
              />
            </label>

            <label className="company-field">
              <span>Correo</span>
              <input
                type="email"
                value={form.correo}
                onChange={(event) => handleFieldChange('correo', event.target.value)}
                placeholder="contacto@empresa.com"
              />
            </label>

            <label className="company-field">
              <span>Sitio web</span>
              <input
                value={form.sitio_web}
                onChange={(event) => handleFieldChange('sitio_web', event.target.value)}
                placeholder="https://empresa.com"
              />
            </label>

            <label className="company-field company-field--full">
              <span>Direccion</span>
              <input
                value={form.direccion}
                onChange={(event) => handleFieldChange('direccion', event.target.value)}
                placeholder="Ciudad, pais o direccion comercial"
              />
            </label>

            <label className="company-field company-field--full">
              <span>Descripcion</span>
              <textarea
                value={form.descripcion}
                onChange={(event) => handleFieldChange('descripcion', event.target.value)}
                placeholder="Describe brevemente la empresa, unidad de negocio o notas operativas."
              />
            </label>

            <label className="company-toggle">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={(event) => handleFieldChange('activo', event.target.checked)}
              />
              <span>Empresa activa para esta plataforma</span>
            </label>

            <label className="company-toggle">
              <input
                type="checkbox"
                checked={form.syncToConfig}
                onChange={(event) => handleFieldChange('syncToConfig', event.target.checked)}
              />
              <span>Sincronizar este token con la configuracion ({tokenConfigKey})</span>
            </label>

            <div className="company-form__footer">
              <span className="company-form__hint">{validationMessage}</span>
              <button className="btn btn--start company-form__submit" type="submit" disabled={!canSave}>
                {saving ? 'Guardando...' : 'Guardar empresa'}
              </button>
            </div>
          </form>

          {message && <p className="company-feedback company-feedback--success">{message}</p>}
          {error && <p className="company-feedback company-feedback--error">{error}</p>}
        </section>

        <section className="company-list-card glass-card">
          <div className="card-header">
            <span className="card-icon">&#128203;</span>
            <span className="card-title">Registros guardados</span>
          </div>

          <div className="company-list-summary">
            <div className="company-stat">
              <span className="company-stat__label">Plataforma</span>
              <strong>{currentPlatform.label}</strong>
            </div>
            <div className="company-stat">
              <span className="company-stat__label">Total empresas</span>
              <strong>{records.length}</strong>
            </div>
          </div>

          {loading ? (
            <div className="company-empty">Cargando registros...</div>
          ) : records.length === 0 ? (
            <div className="company-empty">Todavia no hay empresas registradas en esta plataforma.</div>
          ) : (
            <div className="company-records">
              {records.map((record) => (
                <article key={`${record.id}-${record.nombre}`} className="company-record">
                  <div className="company-record__header">
                    <div>
                      <h3>{record.nombre}</h3>
                      <p>ID empresa {record.empresa_id ?? record.id}</p>
                    </div>
                    <div className="company-record__actions">
                      <span className={`job-badge ${record.activo ? 'badge--success' : 'badge--warn'}`}>
                        {record.activo ? 'Activa' : 'Inactiva'}
                      </span>
                      <button
                        className="btn btn--ghost btn--small company-record__delete"
                        type="button"
                        onClick={() => void handleDeleteRecord(record)}
                        disabled={deletingEmpresaId === (record.empresa_id ?? record.id)}
                      >
                        {deletingEmpresaId === (record.empresa_id ?? record.id) ? 'Eliminando...' : 'Eliminar'}
                      </button>
                    </div>
                  </div>

                  <div className="company-record__grid">
                    <div>
                      <span>Correo</span>
                      <strong>{record.correo || 'Sin correo'}</strong>
                    </div>
                    <div>
                      <span>Telefono</span>
                      <strong>{record.telefono || 'Sin telefono'}</strong>
                    </div>
                    <div>
                      <span>Sitio web</span>
                      <strong>{record.sitio_web || 'Sin sitio web'}</strong>
                    </div>
                    <div>
                      <span>Logo</span>
                      <strong>{formatLogoLabel(record.logo)}</strong>
                    </div>
                    <div>
                      <span>Token</span>
                      <strong>{maskToken(record.token)}</strong>
                    </div>
                    <div>
                      <span>Config</span>
                      <strong>{record.config_env_key || tokenConfigKey}</strong>
                    </div>
                  </div>

                  {record.direccion && (
                    <p className="company-record__text">
                      <span>Direccion:</span> {record.direccion}
                    </p>
                  )}
                  {record.descripcion && (
                    <p className="company-record__text">
                      <span>Descripcion:</span> {record.descripcion}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
