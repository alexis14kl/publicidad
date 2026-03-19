import { useRef, useState } from 'react'
import type { CompanyRecord } from '../shared/api/types'

interface ReelModalProps {
  open: boolean
  onClose: () => void
  companies: CompanyRecord[]
  selectedCompany: string
}

const WEBHOOK_URL = 'https://n8n-dev.noyecode.com/webhook/publicar-reel-fb'

export function ReelModal({ open, onClose, companies, selectedCompany }: ReelModalProps) {
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const company = companies.find((c) => c.nombre === selectedCompany)
  const pageId = company?.platforms.find((p) => p.platform === 'facebook')?.accounts?.[0]?.page_id || ''
  const token = company?.platforms.find((p) => p.platform === 'facebook')?.accounts?.[0]?.token || ''

  const canPublish = !!videoFile && !!token && !!pageId && status !== 'uploading'

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('video/')) {
        setMessage('Solo se permiten archivos de video (MP4, MOV, etc.)')
        return
      }
      setVideoFile(file)
      setMessage(`Video seleccionado: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`)
    }
  }

  const handlePublish = async () => {
    if (!canPublish || !videoFile) return
    setStatus('uploading')
    setMessage('Subiendo video a Facebook...')

    try {
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(videoFile)
      })

      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: token,
          page_id: pageId,
          videoBase64: base64,
          title: title.trim() || 'Reel publicitario',
          description: caption.trim(),
        }),
      })

      const data = await response.json()
      if (data.status === 'success') {
        setStatus('success')
        setMessage(`Reel publicado exitosamente. Post ID: ${data.post_id || 'pendiente'}`)
      } else {
        setStatus('error')
        setMessage(`Error: ${data.message || 'No se pudo publicar el reel'}`)
      }
    } catch (err) {
      setStatus('error')
      setMessage(`Error de conexion: ${err instanceof Error ? err.message : 'desconocido'}`)
    }
  }

  const handleClose = () => {
    if (status === 'uploading') return
    setTitle('')
    setCaption('')
    setVideoFile(null)
    setStatus('idle')
    setMessage('')
    onClose()
  }

  if (!open) return null

  return (
    <div className="marketing-modal-backdrop" onClick={handleClose}>
      <section
        className="reel-modal glass-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="reel-modal__header">
          <div>
            <p className="marketing-modal__eyebrow">Video</p>
            <h2 className="marketing-modal__title">Publicar Reel en Facebook</h2>
          </div>
          <button className="btn btn--small btn--ghost" onClick={handleClose} disabled={status === 'uploading'}>
            Cerrar
          </button>
        </div>

        <div className="reel-modal__body">
          <div className="reel-modal__info">
            <span className="reel-modal__company">
              Empresa: <strong>{company?.nombre || 'Sin empresa'}</strong>
            </span>
            <span className="reel-modal__page">
              Page ID: <strong>{pageId || 'Sin configurar'}</strong>
            </span>
          </div>

          {!token && (
            <div className="reel-modal__warning">
              La empresa seleccionada no tiene token de Facebook configurado.
            </div>
          )}

          <div
            className={`reel-modal__dropzone ${videoFile ? 'reel-modal__dropzone--has-file' : ''}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {videoFile ? (
              <div className="reel-modal__file-info">
                <span className="reel-modal__file-icon">&#127916;</span>
                <span className="reel-modal__file-name">{videoFile.name}</span>
                <span className="reel-modal__file-size">{(videoFile.size / 1024 / 1024).toFixed(1)} MB</span>
              </div>
            ) : (
              <div className="reel-modal__drop-text">
                <span className="reel-modal__drop-icon">&#128249;</span>
                <span>Click para seleccionar video</span>
                <small>MP4, MOV - Max 1GB - 9:16 vertical recomendado</small>
              </div>
            )}
          </div>

          <label className="marketing-field">
            <span>Titulo del Reel</span>
            <input
              type="text"
              placeholder="Ej: Automatiza tu negocio con NoyeCode"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={status === 'uploading'}
            />
          </label>

          <label className="marketing-field">
            <span>Caption / Descripcion</span>
            <textarea
              className="reel-modal__caption"
              placeholder="Escribe el texto que acompanara tu reel..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              disabled={status === 'uploading'}
            />
          </label>

          {message && (
            <div className={`reel-modal__message reel-modal__message--${status}`}>
              {message}
            </div>
          )}
        </div>

        <div className="reel-modal__footer">
          <button
            className="btn btn--reel-publish"
            disabled={!canPublish}
            onClick={handlePublish}
          >
            {status === 'uploading' ? 'Publicando...' : 'Publicar Reel'}
          </button>
        </div>
      </section>
    </div>
  )
}
