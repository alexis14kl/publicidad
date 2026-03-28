import { useEffect, useState } from 'react'
import { pubList, pubDelete, pubDeleteAll } from '../api/commands'
import type { PublicationRecord } from '../api/types'

const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
}

const PLATFORM_COLORS: Record<string, string> = {
  facebook: '#1877f2',
  instagram: '#e1306c',
  tiktok: '#000000',
  linkedin: '#0a66c2',
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  published: { label: 'Publicado', className: 'pub-status--published' },
  deleted: { label: 'Eliminado', className: 'pub-status--deleted' },
  failed: { label: 'Fallido', className: 'pub-status--failed' },
}

const CONTENT_ICONS: Record<string, string> = {
  text: '\u270D',
  image: '\uD83D\uDDBC',
  video: '\uD83C\uDFA5',
  reel: '\uD83C\uDFAC',
  link: '\uD83D\uDD17',
  story: '\u26A1',
  carousel: '\uD83C\uDFA0',
}

export function PublicationsPage() {
  const [publications, setPublications] = useState<PublicationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filterPlatform, setFilterPlatform] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadPublications = async () => {
    setLoading(true)
    try {
      const payload: Record<string, string> = {}
      if (filterPlatform) payload.platform = filterPlatform
      if (filterStatus) payload.status = filterStatus
      const result = await pubList(payload)
      setPublications(result.success ? result.publications : [])
    } catch {
      setPublications([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadPublications() }, [filterPlatform, filterStatus])

  const handleDelete = async (pub: PublicationRecord) => {
    if (!window.confirm(`Eliminar publicacion de ${pub.page_name || pub.company_name}?\n\nPost ID: ${pub.post_id}\n\nEsto eliminara el post de la plataforma y lo marcara como eliminado.`)) return

    setDeletingId(pub.post_id)
    setMessage(null)
    setError(null)

    try {
      const result = await pubDelete({ postId: pub.post_id, platform: pub.platform })
      if (result.success) {
        setMessage(`Post eliminado de ${PLATFORM_LABELS[pub.platform] || pub.platform}.`)
      } else {
        setError(result.error || 'No se pudo eliminar.')
      }
      await loadPublications()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar.')
    } finally {
      setDeletingId(null)
    }
  }

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('es-CO', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return dateStr }
  }

  const truncate = (text: string, max: number) =>
    text.length > max ? text.slice(0, max) + '...' : text

  return (
    <div className="pub-page">
      {/* ── Header ────────────────────────────────────────────────── */}
      <section className="pub-header glass-card">
        <div>
          <h2 className="pub-header__title">Historial de Publicaciones</h2>
          <p className="pub-header__text">
            Registro de todos los posts publicados. Puedes eliminar publicaciones desde aqui.
          </p>
        </div>
        <span className="company-chip">{publications.length} publicacion(es)</span>
      </section>

      {/* ── Filtros ───────────────────────────────────────────────── */}
      <div className="pub-filters">
        <select className="pub-filter-select" value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
          <option value="">Todas las plataformas</option>
          <option value="facebook">Facebook</option>
          <option value="instagram">Instagram</option>
        </select>
        <select className="pub-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="published">Publicados</option>
          <option value="deleted">Eliminados</option>
          <option value="failed">Fallidos</option>
        </select>
        <button className="btn btn--ghost btn--small" onClick={() => void loadPublications()}>
          Actualizar
        </button>
        {publications.filter(p => p.status === 'published').length > 0 && (
          <button
            className="btn btn--ghost btn--small pub-delete-all-btn"
            disabled={deletingId !== null}
            onClick={async () => {
              const count = publications.filter(p => p.status === 'published').length
              if (!window.confirm(`Eliminar TODAS las ${count} publicaciones activas de las plataformas?\n\nEsta accion no se puede deshacer.`)) return
              setDeletingId('all')
              setMessage(null)
              setError(null)
              try {
                const result = await pubDeleteAll()
                if (result.success) {
                  setMessage(`${result.deleted} eliminadas, ${result.failed} fallidas.`)
                } else {
                  setError(result.error || 'Error al eliminar.')
                }
                await loadPublications()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Error.')
              } finally {
                setDeletingId(null)
              }
            }}
          >
            {deletingId === 'all' ? 'Eliminando...' : 'Eliminar todas'}
          </button>
        )}
      </div>

      {/* ── Mensajes ──────────────────────────────────────────────── */}
      {message && <p className="company-feedback company-feedback--success">{message}</p>}
      {error && <p className="company-feedback company-feedback--error">{error}</p>}

      {/* ── Lista ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="pub-empty">Cargando...</div>
      ) : publications.length === 0 ? (
        <div className="pub-empty">
          No hay publicaciones registradas. Las publicaciones apareceran aqui automaticamente al publicar contenido.
        </div>
      ) : (
        <div className="pub-list">
          {publications.map((pub) => {
            const statusInfo = STATUS_MAP[pub.status] || STATUS_MAP.published
            const platformColor = PLATFORM_COLORS[pub.platform] || '#666'
            return (
              <div key={pub.id} className={`pub-card glass-card ${pub.status === 'deleted' ? 'pub-card--deleted' : ''}`}>
                <div className="pub-card__left">
                  <span className="pub-card__type-icon">{CONTENT_ICONS[pub.content_type] || '\u270D'}</span>
                  <div className="pub-card__info">
                    <div className="pub-card__top">
                      <span className="pub-card__platform" style={{ background: platformColor }}>
                        {PLATFORM_LABELS[pub.platform] || pub.platform}
                      </span>
                      <span className={`pub-card__status ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                      <span className="pub-card__date">{formatDate(pub.published_at)}</span>
                    </div>
                    <div className="pub-card__company">{pub.page_name || pub.company_name || 'Sin nombre'}</div>
                    {pub.message && (
                      <div className="pub-card__message">{truncate(pub.message, 120)}</div>
                    )}
                    <div className="pub-card__id">ID: {pub.post_id}</div>
                  </div>
                </div>
                <div className="pub-card__actions">
                  {pub.status === 'published' && (
                    <button
                      className="btn btn--ghost btn--small pub-card__delete"
                      onClick={() => void handleDelete(pub)}
                      disabled={deletingId === pub.post_id}
                    >
                      {deletingId === pub.post_id ? '...' : 'Eliminar'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
