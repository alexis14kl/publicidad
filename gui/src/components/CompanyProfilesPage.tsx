import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  deleteCompanyRecord,
  listCompanyRecords,
  saveCompanyRecord,
  selectCompanyLogoSvg,
  selectCompanyPublicationAccount,
} from '../lib/commands'
import type { CompanyPlatform, CompanyPlatformRecord, CompanyRecord, SaveCompanyPayload } from '../lib/types'

const PLATFORM_OPTIONS: { key: CompanyPlatform; label: string; dbFile: string; configKey: string }[] = [
  { key: 'facebook', label: 'Facebook', dbFile: 'facebook.sqlite3', configKey: 'FB_ACCESS_TOKEN' },
  { key: 'tiktok', label: 'TikTok', dbFile: 'tiktok.sqlite3', configKey: 'TIKTOK_ACCESS_TOKEN' },
  { key: 'linkedin', label: 'LinkedIn', dbFile: 'linkedin.sqlite3', configKey: 'LINKEDIN_ACCESS_TOKEN' },
  { key: 'instagram', label: 'Instagram', dbFile: 'instagram.sqlite3', configKey: 'INSTAGRAM_ACCESS_TOKEN' },
  { key: 'googleads', label: 'Google Ads', dbFile: 'googleads.sqlite3', configKey: 'GOOGLE_ADS_ACCESS_TOKEN' },
]

const ACCOUNT_SLOTS = 5

function createEmptyAccounts() {
  return Array.from({ length: ACCOUNT_SLOTS }, (_, index) => ({
    account_label: `Cuenta ${index + 1}`,
    token: '',
  }))
}

function createEmptyPlatforms() {
  return {
    facebook: { enabled: false, syncToConfig: true, accounts: createEmptyAccounts() },
    tiktok: { enabled: false, syncToConfig: true, accounts: createEmptyAccounts() },
    linkedin: { enabled: false, syncToConfig: true, accounts: createEmptyAccounts() },
    instagram: { enabled: false, syncToConfig: true, accounts: createEmptyAccounts() },
    googleads: { enabled: false, syncToConfig: true, accounts: createEmptyAccounts() },
  }
}

function createVisibleAccountCounts() {
  return {
    facebook: 1,
    tiktok: 1,
    linkedin: 1,
    instagram: 1,
    googleads: 1,
  }
}

const EMPTY_FORM = {
  nombre: '',
  logo: '',
  telefono: '',
  correo: '',
  sitio_web: '',
  direccion: '',
  descripcion: '',
  activo: true,
  platforms: createEmptyPlatforms(),
}

type FormState = typeof EMPTY_FORM

export function CompanyProfilesPage() {
  const [records, setRecords] = useState<CompanyRecord[]>([])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [visibleAccountCounts, setVisibleAccountCounts] = useState(createVisibleAccountCounts)
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null)
  const [logoFileName, setLogoFileName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingCompanyName, setDeletingCompanyName] = useState<string | null>(null)
  const [selectingPublicationKey, setSelectingPublicationKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedPlatforms = useMemo(
    () => PLATFORM_OPTIONS.filter((option) => form.platforms[option.key].enabled),
    [form.platforms]
  )

  const totalConfiguredAccounts = useMemo(
    () =>
      selectedPlatforms.reduce((sum, option) => {
        const accounts = form.platforms[option.key].accounts.filter((account) => account.token.trim())
        return sum + accounts.length
      }, 0),
    [form.platforms, selectedPlatforms]
  )

  const recordAccountCount = useMemo(
    () => records.reduce((sum, record) => sum + record.platforms.reduce((inner, platform) => inner + platform.accounts.length, 0), 0),
    [records]
  )

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
    if (!form.correo.trim() && !form.telefono.trim()) return 'Agrega al menos un correo o un telefono de contacto.'
    if (selectedPlatforms.length === 0) return 'Marca al menos una red social para esta empresa.'
    const invalidPlatform = selectedPlatforms.find(
      (option) => !form.platforms[option.key].accounts.some((account) => account.token.trim())
    )
    if (invalidPlatform) {
      return `Agrega al menos una cuenta con token para ${invalidPlatform.label}.`
    }
    return 'Formulario listo para guardar empresa, redes sociales y cuentas.'
  }, [form, selectedPlatforms])

  const canSave =
    !!form.nombre.trim() &&
    (!!form.correo.trim() || !!form.telefono.trim()) &&
    selectedPlatforms.length > 0 &&
    selectedPlatforms.every((option) => form.platforms[option.key].accounts.some((account) => account.token.trim())) &&
    !saving

  const loadRecords = async () => {
    setLoading(true)
    setError(null)
    try {
      const nextRecords = await listCompanyRecords()
      setRecords(nextRecords)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los registros.')
      setRecords([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRecords()
  }, [])

  const handleFieldChange = <K extends keyof Omit<FormState, 'platforms'>>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setMessage(null)
    setError(null)
  }

  const handlePlatformToggle = (platform: CompanyPlatform, enabled: boolean) => {
    setForm((prev) => ({
      ...prev,
      platforms: {
        ...prev.platforms,
        [platform]: {
          ...prev.platforms[platform],
          enabled,
        },
      },
    }))
    setVisibleAccountCounts((prev) => ({
      ...prev,
      [platform]: 1,
    }))
    setMessage(null)
    setError(null)
  }

  const handlePlatformSyncToggle = (platform: CompanyPlatform, syncToConfig: boolean) => {
    setForm((prev) => ({
      ...prev,
      platforms: {
        ...prev.platforms,
        [platform]: {
          ...prev.platforms[platform],
          syncToConfig,
        },
      },
    }))
    setMessage(null)
    setError(null)
  }

  const handlePlatformAccountChange = (
    platform: CompanyPlatform,
    index: number,
    key: 'account_label' | 'token',
    value: string
  ) => {
    setForm((prev) => ({
      ...prev,
      platforms: {
        ...prev.platforms,
        [platform]: {
          ...prev.platforms[platform],
          accounts: prev.platforms[platform].accounts.map((account, accountIndex) =>
            accountIndex === index ? { ...account, [key]: value } : account
          ),
        },
      },
    }))
    setMessage(null)
    setError(null)
  }

  const handleAddPlatformAccount = (platform: CompanyPlatform) => {
    setVisibleAccountCounts((prev) => ({
      ...prev,
      [platform]: Math.min(prev[platform] + 1, ACCOUNT_SLOTS),
    }))
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
    const companyName = record.nombre.trim()
    if (!companyName) return

    const confirmed = window.confirm(`Se eliminara la empresa "${record.nombre}" con todas sus redes sociales. Continuar?`)
    if (!confirmed) return

    setDeletingCompanyName(companyName)
    setMessage(null)
    setError(null)

    try {
      const result = await deleteCompanyRecord({ companyName })
      if (!result.success) {
        throw new Error('No se pudo eliminar la empresa.')
      }
      setMessage(`Empresa eliminada: ${result.deletedName || record.nombre}`)
      await loadRecords()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la empresa.')
    } finally {
      setDeletingCompanyName(null)
    }
  }

  const handleSelectPublicationAccount = async (
    record: CompanyRecord,
    platformRecord: CompanyPlatformRecord,
    accountIndex: number
  ) => {
    const companyName = record.nombre.trim()
    if (!companyName) return

    const selectionKey = `${companyName}:${platformRecord.platform}:${accountIndex}`
    setSelectingPublicationKey(selectionKey)
    setMessage(null)
    setError(null)

    try {
      const result = await selectCompanyPublicationAccount({
        companyName,
        platform: platformRecord.platform,
        accountIndex,
      })

      if (!result.success) {
        throw new Error('No se pudo seleccionar la cuenta para publicaciones.')
      }

      setMessage(
        `Cuenta ${accountIndex} de ${platformRecord.label} activa para publicaciones. Token sincronizado en ${result.envKey}.`
      )
      await loadRecords()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo seleccionar la cuenta para publicaciones.')
    } finally {
      setSelectingPublicationKey(null)
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
        nombre: form.nombre.trim(),
        logo: form.logo.trim(),
        telefono: form.telefono.trim(),
        correo: form.correo.trim(),
        sitio_web: form.sitio_web.trim(),
        direccion: form.direccion.trim(),
        descripcion: form.descripcion.trim(),
        activo: form.activo,
        platforms: {
          facebook: form.platforms.facebook,
          tiktok: form.platforms.tiktok,
          linkedin: form.platforms.linkedin,
          instagram: form.platforms.instagram,
          googleads: form.platforms.googleads,
        },
      }
      const savedRecord = await saveCompanyRecord(payload)
      setMessage(
        `Empresa guardada: ${savedRecord.nombre}. Redes activas: ${savedRecord.platforms.map((platform) => platform.label).join(', ')}.`
      )
      setForm({ ...EMPTY_FORM, platforms: createEmptyPlatforms() })
      setVisibleAccountCounts(createVisibleAccountCounts())
      setLogoFileName('')
      setLogoPreviewUrl(null)
      await loadRecords()
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
          <p className="company-hero__eyebrow">Empresas y Redes Sociales</p>
          <h2 className="company-hero__title">Formulario unico para empresas, redes y cuentas</h2>
          <p className="company-hero__text">
            Registra la empresa una sola vez y marca las redes sociales que maneja. Cada red permite hasta{' '}
            <strong>{ACCOUNT_SLOTS} cuentas</strong> y se sincroniza con la configuracion usando la cuenta principal
            de la red seleccionada.
          </p>
        </div>
        <div className="company-hero__meta">
          <span className="company-chip">{selectedPlatforms.length} redes activas</span>
          <span className="company-chip company-chip--dim">{totalConfiguredAccounts} cuentas en formulario</span>
          <span className="company-chip company-chip--dim">Checks por red social</span>
        </div>
      </section>

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
              <span>Telefono</span>
              <input
                value={form.telefono}
                onChange={(event) => handleFieldChange('telefono', event.target.value)}
                placeholder="+57 300 000 0000"
              />
            </label>

            <label className="company-field">
              <span>Logo</span>
              <div className="company-logo-picker">
                <div className="company-logo-picker__actions">
                  <button className="btn btn--ghost btn--small" type="button" onClick={handleSelectLogo}>
                    Cargar SVG
                  </button>
                  <button className="btn btn--ghost btn--small" type="button" onClick={handleClearLogo} disabled={!form.logo}>
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

            <section className="company-network-selector company-field--full">
              <div className="company-network-selector__header">
                <span>Redes sociales</span>
                <small>Marca las redes que maneja esta empresa</small>
              </div>
              <div className="company-network-checks">
                {PLATFORM_OPTIONS.map((option) => (
                  <label
                    key={option.key}
                    className={`company-network-check ${
                      form.platforms[option.key].enabled ? 'company-network-check--active' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={form.platforms[option.key].enabled}
                      onChange={(event) => handlePlatformToggle(option.key, event.target.checked)}
                    />
                    <div>
                      <strong>{option.label}</strong>
                      <span>{option.dbFile}</span>
                    </div>
                  </label>
                ))}
              </div>
            </section>

            {selectedPlatforms.length > 0 && (
              <section className="company-network-groups company-field--full">
                {selectedPlatforms.map((option) => (
                  <div key={option.key} className="company-network-group">
                    <div className="company-network-group__header">
                      <div>
                        <h3>{option.label}</h3>
                        <p>Configura hasta {ACCOUNT_SLOTS} cuentas para esta red social.</p>
                      </div>
                      <label className="company-toggle company-toggle--compact">
                        <input
                          type="checkbox"
                          checked={form.platforms[option.key].syncToConfig}
                          onChange={(event) => handlePlatformSyncToggle(option.key, event.target.checked)}
                        />
                        <span>Sincronizar cuenta principal en {option.configKey}</span>
                      </label>
                    </div>

                    <div className="company-account-grid">
                      {form.platforms[option.key].accounts.slice(0, visibleAccountCounts[option.key]).map((account, index) => (
                        <div key={`${option.key}-${index}`} className="company-account-row">
                          <label className="company-field">
                            <span>Nombre de cuenta {index + 1}</span>
                            <input
                              value={account.account_label}
                              onChange={(event) =>
                                handlePlatformAccountChange(option.key, index, 'account_label', event.target.value)
                              }
                              placeholder={`Cuenta ${index + 1}`}
                            />
                          </label>
                          <label className="company-field">
                            <span>Token cuenta {index + 1}</span>
                            <input
                              value={account.token}
                              onChange={(event) =>
                                handlePlatformAccountChange(option.key, index, 'token', event.target.value)
                              }
                              placeholder={`Token ${option.label} cuenta ${index + 1}`}
                            />
                          </label>
                        </div>
                      ))}
                    </div>

                    {visibleAccountCounts[option.key] < ACCOUNT_SLOTS && (
                      <div className="company-network-group__footer">
                        <button
                          className="btn btn--ghost btn--small"
                          type="button"
                          onClick={() => handleAddPlatformAccount(option.key)}
                        >
                          Anadir mas cuenta
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </section>
            )}

            <label className="company-toggle">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={(event) => handleFieldChange('activo', event.target.checked)}
              />
              <span>Empresa activa</span>
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
              <span className="company-stat__label">Total empresas</span>
              <strong>{records.length}</strong>
            </div>
            <div className="company-stat">
              <span className="company-stat__label">Total cuentas</span>
              <strong>{recordAccountCount}</strong>
            </div>
          </div>

          {loading ? (
            <div className="company-empty">Cargando registros...</div>
          ) : records.length === 0 ? (
            <div className="company-empty">Todavia no hay empresas registradas.</div>
          ) : (
            <div className="company-records">
              {records.map((record) => (
                <article key={record.id} className="company-record">
                  <div className="company-record__header">
                    <div>
                      <h3>{record.nombre}</h3>
                      <p>{record.platforms.length} redes activas</p>
                    </div>
                    <div className="company-record__actions">
                      <span className={`job-badge ${record.activo ? 'badge--success' : 'badge--warn'}`}>
                        {record.activo ? 'Activa' : 'Inactiva'}
                      </span>
                      <button
                        className="btn btn--ghost btn--small company-record__delete"
                        type="button"
                        onClick={() => void handleDeleteRecord(record)}
                        disabled={deletingCompanyName === record.nombre}
                      >
                        {deletingCompanyName === record.nombre ? 'Eliminando...' : 'Eliminar'}
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

                  <div className="company-record__platforms">
                    {record.platforms.map((platform: CompanyPlatformRecord) => (
                      <div key={`${record.id}-${platform.platform}`} className="company-record__platform">
                        <div className="company-record__platform-header">
                          <div>
                            <strong>{platform.label}</strong>
                            <span>{platform.accounts.length} cuentas</span>
                          </div>
                          <small>{platform.config_env_key}</small>
                        </div>
                        <div className="company-record__accounts">
                          {platform.accounts.map((account) => (
                            <div
                              key={`${platform.platform}-${account.account_index}-${account.red_id || account.account_label}`}
                              className="company-record__account"
                            >
                              <div className="company-record__account-meta">
                                <span>{account.account_label || `Cuenta ${account.account_index}`}</span>
                                <strong>{maskToken(account.token)}</strong>
                              </div>
                              <div className="company-record__account-actions">
                                {account.is_primary ? (
                                  <span className="company-account-badge">Cuenta activa</span>
                                ) : (
                                  <button
                                    className="btn btn--ghost btn--small company-record__activate"
                                    type="button"
                                    onClick={() =>
                                      void handleSelectPublicationAccount(record, platform, account.account_index)
                                    }
                                    disabled={
                                      selectingPublicationKey ===
                                      `${record.nombre.trim()}:${platform.platform}:${account.account_index}`
                                    }
                                  >
                                    {selectingPublicationKey ===
                                    `${record.nombre.trim()}:${platform.platform}:${account.account_index}`
                                      ? 'Activando...'
                                      : 'Usar para publicar'}
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
