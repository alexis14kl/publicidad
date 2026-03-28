import { useEffect, useState } from 'react'
import {
  deleteCompanyRecord,
  listCompanyRecords,
  metaCheckTokenPermissions,
  oauthAutoCreateAccounts,
  oauthStart,
  saveCompanyRecord,
  selectCompanyPublicationAccount,
  toggleCompanyActive,
} from '../api/commands'
import type { CompanyPlatform, CompanyPlatformRecord, CompanyRecord, OAuthAccount, OAuthPlatform, SaveCompanyPayload } from '../api/types'
import { DEFAULT_BRAND_COLORS } from '../api/types'

const OAUTH_PLATFORMS: { key: OAuthPlatform; label: string; enabled: boolean; color: string; icon: string }[] = [
  { key: 'facebook', label: 'Facebook', enabled: true, color: '#1877f2', icon: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' },
  { key: 'tiktok', label: 'TikTok', enabled: false, color: '#000000', icon: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z' },
  { key: 'linkedin', label: 'LinkedIn', enabled: false, color: '#0a66c2', icon: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' },
]

interface CompanyProfilesPageProps {
  onCompaniesChanged?: () => void
}

export function CompanyProfilesPage({ onCompaniesChanged }: CompanyProfilesPageProps) {
  const [records, setRecords] = useState<CompanyRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [oauthConnecting, setOauthConnecting] = useState<string | null>(null)
  const [editingRecord, setEditingRecord] = useState<CompanyRecord | null>(null)
  const [deletingName, setDeletingName] = useState<string | null>(null)
  const [togglingName, setTogglingName] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadRecords = async () => {
    setLoading(true)
    setError(null)
    try {
      setRecords(await listCompanyRecords())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los registros.')
      setRecords([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadRecords() }, [])

  const maskToken = (value: string) => {
    const clean = value.trim()
    if (!clean) return 'Sin token'
    if (clean.length <= 10) return clean
    return `${clean.slice(0, 5)}...${clean.slice(-4)}`
  }

  // ── OAuth connect ──────────────────────────────────────────────────────
  const handleOAuthConnect = async (platform: OAuthPlatform) => {
    setOauthConnecting(platform)
    setMessage(null)
    setError(null)

    try {
      const result = await oauthStart(platform)
      if (!result.success || !result.accounts?.length) {
        throw new Error(result.error || 'No se obtuvieron cuentas.')
      }

      const createResult = await oauthAutoCreateAccounts(result.accounts as OAuthAccount[])
      if (!createResult.success) {
        throw new Error(createResult.error || 'No se pudieron crear las cuentas.')
      }

      setMessage(`${createResult.created_count} pagina(s) conectada(s) desde ${platform}.`)
      await loadRecords()
      onCompaniesChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al conectar.')
    } finally {
      setOauthConnecting(null)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────
  const handleDelete = async (record: CompanyRecord) => {
    if (!window.confirm(`Eliminar "${record.nombre}" y todas sus cuentas?`)) return
    setDeletingName(record.nombre)
    setMessage(null)
    setError(null)
    try {
      await deleteCompanyRecord({ companyName: record.nombre })
      setMessage(`Eliminada: ${record.nombre}`)
      if (editingRecord?.nombre === record.nombre) setEditingRecord(null)
      await loadRecords()
      onCompaniesChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar.')
    } finally {
      setDeletingName(null)
    }
  }

  // ── Toggle active ──────────────────────────────────────────────────────
  const handleToggle = async (record: CompanyRecord) => {
    const next = !record.activo
    setTogglingName(record.nombre)
    setMessage(null)
    setError(null)
    try {
      await toggleCompanyActive({ companyName: record.nombre, active: next })
      setMessage(`${record.nombre} ${next ? 'activada' : 'desactivada'}.`)
      await loadRecords()
      onCompaniesChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar.')
    } finally {
      setTogglingName(null)
    }
  }

  // ── Select publication account ─────────────────────────────────────────
  const handleSelectAccount = async (record: CompanyRecord, platform: CompanyPlatformRecord, accountIndex: number) => {
    setMessage(null)
    setError(null)
    try {
      await selectCompanyPublicationAccount({ companyName: record.nombre, platform: platform.platform, accountIndex })
      setMessage(`Cuenta activa actualizada para ${record.nombre}.`)
      await loadRecords()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo seleccionar la cuenta.')
    }
  }

  // ── Inline edit save ───────────────────────────────────────────────────
  const handleEditSave = async (record: CompanyRecord, updates: Partial<{
    telefono: string; correo: string; sitio_web: string; descripcion: string; direccion: string;
    color_primario: string; color_cta: string; color_acento: string; color_checks: string; color_fondo: string;
  }>) => {
    setMessage(null)
    setError(null)
    try {
      const platforms: Record<CompanyPlatform, { enabled: boolean; syncToConfig: boolean; accounts: { account_label?: string; token?: string; page_id?: string; account_id?: string }[] }> = {
        facebook: { enabled: false, syncToConfig: true, accounts: [] },
        tiktok: { enabled: false, syncToConfig: true, accounts: [] },
        linkedin: { enabled: false, syncToConfig: true, accounts: [] },
        instagram: { enabled: false, syncToConfig: true, accounts: [] },
        googleads: { enabled: false, syncToConfig: true, accounts: [] },
      }
      for (const p of record.platforms) {
        platforms[p.platform] = {
          enabled: true,
          syncToConfig: true,
          accounts: p.accounts.map((a) => ({
            account_label: a.account_label,
            token: a.token,
            page_id: a.page_id,
            account_id: a.account_id,
          })),
        }
      }
      const payload: SaveCompanyPayload = {
        nombre: record.nombre,
        logo: record.logo || '',
        telefono: updates.telefono ?? record.telefono ?? '',
        correo: updates.correo ?? record.correo ?? '',
        sitio_web: updates.sitio_web ?? record.sitio_web ?? '',
        direccion: updates.direccion ?? record.direccion ?? '',
        descripcion: updates.descripcion ?? record.descripcion ?? '',
        color_primario: updates.color_primario ?? record.color_primario ?? DEFAULT_BRAND_COLORS.color_primario,
        color_cta: updates.color_cta ?? record.color_cta ?? DEFAULT_BRAND_COLORS.color_cta,
        color_acento: updates.color_acento ?? record.color_acento ?? DEFAULT_BRAND_COLORS.color_acento,
        color_checks: updates.color_checks ?? record.color_checks ?? DEFAULT_BRAND_COLORS.color_checks,
        color_fondo: updates.color_fondo ?? record.color_fondo ?? DEFAULT_BRAND_COLORS.color_fondo,
        activo: !!record.activo,
        platforms,
      }
      await saveCompanyRecord(payload)
      setMessage(`${record.nombre} actualizada.`)
      setEditingRecord(null)
      await loadRecords()
      onCompaniesChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar.')
    }
  }

  const platformBadge = (platform: string) => {
    const map: Record<string, string> = { facebook: 'FB', instagram: 'IG', tiktok: 'TK', linkedin: 'LI', googleads: 'GA' }
    return map[platform] || platform
  }

  return (
    <div className="company-page">
      {/* ── Hero: conectar plataformas ─────────────────────────────────── */}
      <section className="company-hero glass-card">
        <div>
          <p className="company-hero__eyebrow">Paginas y Cuentas</p>
          <h2 className="company-hero__title">Conecta tus redes sociales</h2>
          <p className="company-hero__text">
            Conecta tus paginas de Facebook, TikTok o LinkedIn. Nosotros nos encargamos de tus ideas!
          </p>
        </div>
        <div className="company-hero__meta">
          <span className="company-chip">{records.length} pagina(s) conectada(s)</span>
        </div>
      </section>

      {/* ── Botones OAuth ──────────────────────────────────────────────── */}
      <section className="company-oauth-buttons glass-card">
        {OAUTH_PLATFORMS.map((p) => (
          <button
            key={p.key}
            className="btn company-oauth-btn"
            style={{ background: p.enabled ? p.color : '#888', opacity: p.enabled ? 1 : 0.5 }}
            type="button"
            onClick={() => p.enabled && handleOAuthConnect(p.key)}
            disabled={!p.enabled || oauthConnecting !== null}
          >
            <svg className="company-oauth-btn__icon" viewBox="0 0 24 24" fill="currentColor">
              <path d={p.icon} />
            </svg>
            {oauthConnecting === p.key
              ? 'Conectando...'
              : p.enabled
                ? `Conectar con ${p.label}`
                : `${p.label} (proximamente)`}
          </button>
        ))}
      </section>

      {/* ── Mensajes ──────────────────────────────────────────────────── */}
      {message && <p className="company-feedback company-feedback--success">{message}</p>}
      {error && <p className="company-feedback company-feedback--error">{error}</p>}

      {/* ── Lista de paginas/cuentas conectadas ────────────────────────── */}
      <section className="company-page-list">
        {loading ? (
          <div className="company-empty">Cargando...</div>
        ) : records.length === 0 ? (
          <div className="company-empty">
            No hay paginas conectadas. Usa los botones de arriba para conectar tus redes sociales.
          </div>
        ) : (
          records.map((record) => (
            <PageCard
              key={record.id}
              record={record}
              isEditing={editingRecord?.nombre === record.nombre}
              isDeleting={deletingName === record.nombre}
              isToggling={togglingName === record.nombre}
              onEdit={() => setEditingRecord(editingRecord?.nombre === record.nombre ? null : record)}
              onDelete={() => void handleDelete(record)}
              onToggle={() => void handleToggle(record)}
              onSelectAccount={(p, idx) => void handleSelectAccount(record, p, idx)}
              onSave={(updates) => void handleEditSave(record, updates)}
              onReconnect={(platform) => void handleOAuthConnect(platform)}
              maskToken={maskToken}
              platformBadge={platformBadge}
            />
          ))
        )}
      </section>
    </div>
  )
}

// ── PageCard component ────────────────────────────────────────────────────

interface PageCardProps {
  record: CompanyRecord
  isEditing: boolean
  isDeleting: boolean
  isToggling: boolean
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
  onSelectAccount: (platform: CompanyPlatformRecord, accountIndex: number) => void
  onSave: (updates: Record<string, string>) => void
  onReconnect: (platform: OAuthPlatform) => void
  maskToken: (token: string) => string
  platformBadge: (platform: string) => string
}

const ALL_SCOPES: { key: string; label: string }[] = [
  { key: 'pages_show_list',           label: 'Paginas' },
  { key: 'pages_manage_posts',        label: 'Publicar' },
  { key: 'pages_read_engagement',     label: 'Engagement' },
  { key: 'pages_manage_engagement',   label: 'Gestionar Engagement' },
  { key: 'pages_manage_ads',          label: 'Ads Pagina' },
  { key: 'ads_management',            label: 'Campañas' },
  { key: 'ads_read',                  label: 'Leer Ads' },
  { key: 'leads_retrieval',           label: 'Leads' },
  { key: 'instagram_basic',           label: 'IG Basico' },
  { key: 'instagram_content_publish', label: 'IG Publicar' },
  { key: 'instagram_manage_comments', label: 'IG Comentarios' },
  { key: 'instagram_manage_insights', label: 'IG Insights' },
]

function PageCard({
  record, isEditing, isDeleting, isToggling,
  onEdit, onDelete, onToggle, onSelectAccount, onSave, onReconnect, maskToken, platformBadge,
}: PageCardProps) {
  const [scopes, setScopes] = useState<string[]>([])
  const [scopesLoading, setScopesLoading] = useState(false)
  const [scopesChecked, setScopesChecked] = useState(false)

  useEffect(() => {
    const primaryAccount = record.platforms
      .flatMap(p => p.accounts)
      .find(a => a.is_primary && a.token)
    if (primaryAccount?.token && !scopesChecked) {
      setScopesLoading(true)
      metaCheckTokenPermissions(primaryAccount.token)
        .then(res => {
          if (res.success && res.scopes) setScopes(res.scopes)
        })
        .catch(() => {})
        .finally(() => { setScopesLoading(false); setScopesChecked(true) })
    }
  }, [record, scopesChecked])

  const [editFields, setEditFields] = useState({
    telefono: record.telefono || '',
    correo: record.correo || '',
    sitio_web: record.sitio_web || '',
    descripcion: record.descripcion || '',
    direccion: record.direccion || '',
    color_primario: record.color_primario || DEFAULT_BRAND_COLORS.color_primario,
    color_cta: record.color_cta || DEFAULT_BRAND_COLORS.color_cta,
    color_acento: record.color_acento || DEFAULT_BRAND_COLORS.color_acento,
    color_checks: record.color_checks || DEFAULT_BRAND_COLORS.color_checks,
    color_fondo: record.color_fondo || DEFAULT_BRAND_COLORS.color_fondo,
  })

  useEffect(() => {
    setEditFields({
      telefono: record.telefono || '',
      correo: record.correo || '',
      sitio_web: record.sitio_web || '',
      descripcion: record.descripcion || '',
      direccion: record.direccion || '',
      color_primario: record.color_primario || DEFAULT_BRAND_COLORS.color_primario,
      color_cta: record.color_cta || DEFAULT_BRAND_COLORS.color_cta,
      color_acento: record.color_acento || DEFAULT_BRAND_COLORS.color_acento,
      color_checks: record.color_checks || DEFAULT_BRAND_COLORS.color_checks,
      color_fondo: record.color_fondo || DEFAULT_BRAND_COLORS.color_fondo,
    })
  }, [record])

  return (
    <article className={`company-page-card glass-card ${!record.activo ? 'company-page-card--inactive' : ''}`}>
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="company-page-card__header">
        <div className="company-page-card__identity">
          {record.logo_url ? (
            <img className="company-page-card__avatar" src={record.logo_url} alt={record.nombre} />
          ) : (
            <div className="company-page-card__avatar company-page-card__avatar--placeholder">
              {record.nombre.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h3>{record.nombre}</h3>
            <div className="company-page-card__badges">
              {record.platforms.map((p) => (
                <span key={p.platform} className={`company-platform-badge company-platform-badge--${p.platform}`}>
                  {platformBadge(p.platform)}
                </span>
              ))}
              <span className={`job-badge ${record.activo ? 'badge--success' : 'badge--warn'}`}>
                {record.activo ? 'Activa' : 'Inactiva'}
              </span>
            </div>
          </div>
        </div>
        <div className="company-record__actions">
          <button className="btn btn--ghost btn--small" type="button" onClick={onToggle}
            disabled={isToggling || isDeleting}>
            {isToggling ? '...' : record.activo ? 'Desactivar' : 'Activar'}
          </button>
          <button className="btn btn--ghost btn--small" type="button" onClick={onEdit}
            disabled={isDeleting}>
            {isEditing ? 'Cerrar' : 'Editar'}
          </button>
          <button className="btn btn--ghost btn--small company-record__delete" type="button"
            onClick={onDelete} disabled={isDeleting || isToggling}>
            {isDeleting ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>

      {/* ── Info rápida ──────────────────────────────────────────── */}
      <div className="company-page-card__info">
        <div><span>Website</span><strong>{record.sitio_web || 'No configurado'}</strong></div>
        <div><span>Telefono</span><strong>{record.telefono || 'No configurado'}</strong></div>
        <div><span>Correo</span><strong>{record.correo || 'No configurado'}</strong></div>
        <div><span>Descripcion</span><strong>{record.descripcion || 'No configurada'}</strong></div>
      </div>

      {/* ── Plataformas y cuentas ────────────────────────────────── */}
      <div className="company-page-card__platforms">
        {record.platforms.map((platform) => (
          <div key={platform.platform} className="company-page-card__platform">
            <div className="company-page-card__platform-header">
              <strong>{platform.label}</strong>
              <small>{platform.accounts.length} cuenta(s)</small>
            </div>
            {platform.accounts.map((account) => (
              <div key={`${platform.platform}-${account.account_index}`} className="company-page-card__account">
                <div className="company-page-card__account-meta">
                  <span>{account.account_label}</span>
                  <strong>{maskToken(account.token)}</strong>
                  {account.page_id && <small>Page ID: {account.page_id}</small>}
                  {account.account_id && <small>Account ID: {account.account_id}</small>}
                </div>
                {account.is_primary ? (
                  <span className="company-account-badge">Activa</span>
                ) : (
                  <button className="btn btn--ghost btn--small" type="button"
                    onClick={() => onSelectAccount(platform, account.account_index)}>
                    Usar
                  </button>
                )}
              </div>
            ))}
            {/* ── Estado de publicidad ─────────────────────────── */}
            {scopesChecked && (() => {
              const canPublish = scopes.includes('pages_manage_posts')
              const canAds = scopes.includes('ads_management')
              const enabled = canPublish && canAds
              return (
                <div className={`company-ad-status ${enabled ? 'company-ad-status--enabled' : 'company-ad-status--disabled'}`}>
                  <span className="company-ad-status__icon">{enabled ? '✓' : '✕'}</span>
                  {enabled
                    ? 'Pagina habilitada para publicidad'
                    : 'No habilitada para publicidad — faltan permisos'}
                </div>
              )
            })()}

            {/* ── Permisos ────────────────────────────────────── */}
            {scopesChecked && (
              <div className="company-scopes">
                {ALL_SCOPES.map(({ key, label }) => {
                  const granted = scopes.includes(key)
                  return (
                    <span key={key} className={`company-scope-badge ${granted ? 'company-scope-badge--granted' : 'company-scope-badge--denied'}`}>
                      {granted ? '✓' : '✕'} {label}
                    </span>
                  )
                })}
              </div>
            )}
            {scopesLoading && (
              <div className="company-scopes">
                <span className="company-scope-badge company-scope-badge--loading">Verificando permisos...</span>
              </div>
            )}

            {platform.platform === 'facebook' && (
              <button className="btn btn--ghost btn--small" type="button" style={{ marginTop: 8 }}
                onClick={() => onReconnect('facebook')}>
                Reconectar Facebook
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ── Panel de edicion (expandible) ────────────────────────── */}
      {isEditing && (
        <div className="company-page-card__edit">
          <div className="company-page-card__edit-grid">
            <label className="company-field">
              <span>Telefono</span>
              <input value={editFields.telefono}
                onChange={(e) => setEditFields((prev) => ({ ...prev, telefono: e.target.value }))}
                placeholder="+57 300 000 0000" />
            </label>
            <label className="company-field">
              <span>Correo</span>
              <input value={editFields.correo}
                onChange={(e) => setEditFields((prev) => ({ ...prev, correo: e.target.value }))}
                placeholder="contacto@pagina.com" />
            </label>
            <label className="company-field">
              <span>Sitio web</span>
              <input value={editFields.sitio_web}
                onChange={(e) => setEditFields((prev) => ({ ...prev, sitio_web: e.target.value }))}
                placeholder="https://pagina.com" />
            </label>
            <label className="company-field">
              <span>Direccion</span>
              <input value={editFields.direccion}
                onChange={(e) => setEditFields((prev) => ({ ...prev, direccion: e.target.value }))}
                placeholder="Ciudad, pais" />
            </label>
            <label className="company-field" style={{ gridColumn: '1 / -1' }}>
              <span>Descripcion</span>
              <textarea value={editFields.descripcion}
                onChange={(e) => setEditFields((prev) => ({ ...prev, descripcion: e.target.value }))}
                placeholder="Describe la pagina o negocio" />
            </label>
          </div>
          <div className="company-page-card__edit-colors">
            <span className="company-field"><span>Colores de marca</span></span>
            <div className="company-colors__grid">
              {([
                { key: 'color_primario', label: 'Primario' },
                { key: 'color_cta', label: 'CTA' },
                { key: 'color_acento', label: 'Acento' },
                { key: 'color_checks', label: 'Checks' },
                { key: 'color_fondo', label: 'Fondo' },
              ] as const).map((c) => (
                <label key={c.key} className="company-colors__picker">
                  <input type="color"
                    value={editFields[c.key]}
                    onChange={(e) => setEditFields((prev) => ({ ...prev, [c.key]: e.target.value }))} />
                  <div className="company-colors__info">
                    <strong>{c.label}</strong>
                    <span>{editFields[c.key]}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="company-page-card__edit-actions">
            <button className="btn btn--start btn--small" type="button"
              onClick={() => onSave(editFields)}>
              Guardar cambios
            </button>
            <button className="btn btn--ghost btn--small" type="button" onClick={onEdit}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
