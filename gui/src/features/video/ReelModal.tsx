import { useRef, useState } from 'react'
import type { CompanyRecord } from '../../api/types'
import { startBot } from '../../api/commands'

interface ReelModalProps {
  open: boolean
  onClose: () => void
  companies: CompanyRecord[]
  selectedCompany: string
}

const WEBHOOK_URL = 'https://n8n-dev.noyecode.com/webhook/publicar-reel-fb'

const REEL_REQUIREMENTS = {
  minWidth: 540,
  minHeight: 960,
  maxSizeMB: 1024,
  maxDurationSec: 90,
  minDurationSec: 3,
  formats: ['video/mp4', 'video/quicktime', 'video/x-m4v'],
  orientation: '9:16 (vertical)',
  recommended: '1080x1920',
}

export function ReelModal({ open, onClose, companies, selectedCompany }: ReelModalProps) {
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [videoPrompt, setVideoPrompt] = useState('')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoMeta, setVideoMeta] = useState<{ width: number; height: number; duration: number } | null>(null)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'generating' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [mode, setMode] = useState<'bot' | 'manual'>('bot')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const company = companies.find((c) => c.nombre === selectedCompany)
  const pageId = company?.platforms.find((p) => p.platform === 'facebook')?.accounts?.[0]?.page_id || ''
  const token = company?.platforms.find((p) => p.platform === 'facebook')?.accounts?.[0]?.token || ''

  const canPublishManual = !!videoFile && !!videoMeta && !!token && !!pageId && status !== 'uploading' && warnings.length === 0
  const canStartBot = !!videoPrompt.trim() && status !== 'generating' && status !== 'uploading'

  const validateVideo = (file: File, meta: { width: number; height: number; duration: number }) => {
    const issues: string[] = []
    const sizeMB = file.size / (1024 * 1024)

    if (sizeMB > REEL_REQUIREMENTS.maxSizeMB) {
      issues.push(`Tamano excede ${REEL_REQUIREMENTS.maxSizeMB}MB (actual: ${sizeMB.toFixed(1)}MB)`)
    }
    if (meta.duration > REEL_REQUIREMENTS.maxDurationSec) {
      issues.push(`Duracion excede ${REEL_REQUIREMENTS.maxDurationSec}s (actual: ${Math.round(meta.duration)}s)`)
    }
    if (meta.duration < REEL_REQUIREMENTS.minDurationSec) {
      issues.push(`Duracion minima ${REEL_REQUIREMENTS.minDurationSec}s (actual: ${Math.round(meta.duration)}s)`)
    }
    if (meta.width > meta.height) {
      issues.push(`Video horizontal detectado (${meta.width}x${meta.height}). Los Reels deben ser verticales 9:16`)
    }
    if (meta.height < REEL_REQUIREMENTS.minHeight) {
      issues.push(`Altura minima ${REEL_REQUIREMENTS.minHeight}px (actual: ${meta.height}px)`)
    }
    if (meta.width < REEL_REQUIREMENTS.minWidth) {
      issues.push(`Ancho minimo ${REEL_REQUIREMENTS.minWidth}px (actual: ${meta.width}px)`)
    }
    if (!REEL_REQUIREMENTS.formats.includes(file.type) && !file.name.toLowerCase().endsWith('.mp4')) {
      issues.push(`Formato no soportado: ${file.type || file.name.split('.').pop()}. Usa MP4 o MOV`)
    }
    return issues
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('video/') && !file.name.toLowerCase().endsWith('.mp4')) {
      setMessage('Solo se permiten archivos de video (MP4, MOV)')
      return
    }

    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const meta = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      }
      setVideoMeta(meta)
      const issues = validateVideo(file, meta)
      setWarnings(issues)
      setVideoFile(file)
      setMessage(
        `${file.name} | ${meta.width}x${meta.height} | ${Math.round(meta.duration)}s | ${(file.size / 1024 / 1024).toFixed(1)}MB`
      )
      URL.revokeObjectURL(video.src)
    }
    video.onerror = () => {
      setVideoFile(null)
      setVideoMeta(null)
      setWarnings(['No se pudo leer el video. Verifica que sea MP4 (H.264) vertical 9:16'])
      setMessage(`${file.name} — Formato no compatible o archivo corrupto`)
      URL.revokeObjectURL(video.src)
    }
    video.src = URL.createObjectURL(file)
  }

  const handleStartBot = async () => {
    if (!canStartBot) return
    setStatus('generating')
    setMessage('Iniciando bot de video con DiCloak + Gemini...')

    try {
      const result = await startBot({
        profileName: 'Flow Veo 3',
        imagePrompt: videoPrompt.trim(),
        companyName: selectedCompany,
        contentType: 'reel',
        reelTitle: title.trim() || 'Reel publicitario',
        reelCaption: caption.trim(),
      } as any)

      if (result.success) {
        setStatus('success')
        setMessage(`Bot de video iniciado (PID: ${result.pid}). Generando reel con IA...`)
      } else {
        setStatus('error')
        setMessage(`Error: ${result.error || 'No se pudo iniciar el bot'}`)
      }
    } catch (err) {
      setStatus('error')
      setMessage(`Error: ${err instanceof Error ? err.message : 'desconocido'}`)
    }
  }

  const handlePublishManual = async () => {
    if (!canPublishManual || !videoFile) return
    setStatus('uploading')
    setMessage('Subiendo video a Facebook...')

    try {
      const formData = new FormData()
      formData.append('video', videoFile, videoFile.name)
      formData.append('access_token', token)
      formData.append('page_id', pageId)
      formData.append('title', title.trim() || 'Reel publicitario')
      formData.append('description', caption.trim())

      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (data.status === 'success') {
        setStatus('success')
        setMessage(`Reel publicado. Post ID: ${data.post_id || 'procesando'}`)
      } else {
        setStatus('error')
        setMessage(`Error: ${data.message || 'No se pudo publicar el reel'}`)
      }
    } catch (err) {
      setStatus('error')
      setMessage(`Error: ${err instanceof Error ? err.message : 'desconocido'}`)
    }
  }

  const handleClose = () => {
    if (status === 'uploading' || status === 'generating') return
    setTitle('')
    setCaption('')
    setVideoPrompt('')
    setVideoFile(null)
    setVideoMeta(null)
    setStatus('idle')
    setMessage('')
    setWarnings([])
    onClose()
  }

  if (!open) return null

  return (
    <div className="marketing-modal-backdrop" onClick={handleClose}>
      <section className="reel-modal glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="reel-modal__header">
          <div>
            <p className="marketing-modal__eyebrow">Video</p>
            <h2 className="marketing-modal__title">Publicar Reel en Facebook</h2>
          </div>
          <button className="btn btn--small btn--ghost" onClick={handleClose} disabled={status === 'uploading' || status === 'generating'}>
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

          <div className="reel-modal__mode-tabs">
            <button
              className={`reel-modal__tab ${mode === 'bot' ? 'reel-modal__tab--active' : ''}`}
              onClick={() => setMode('bot')}
              disabled={status === 'uploading' || status === 'generating'}
            >
              Generar con IA
            </button>
            <button
              className={`reel-modal__tab ${mode === 'manual' ? 'reel-modal__tab--active' : ''}`}
              onClick={() => setMode('manual')}
              disabled={status === 'uploading' || status === 'generating'}
            >
              Subir video manual
            </button>
          </div>

          {mode === 'bot' && (
            <>
              <label className="marketing-field">
                <span>Describe el video que quieres generar</span>
                <textarea
                  className="reel-modal__caption"
                  placeholder="Ej: Un video promocional de 15 segundos mostrando los servicios de automatizacion empresarial, con transiciones dinamicas y texto animado..."
                  value={videoPrompt}
                  onChange={(e) => setVideoPrompt(e.target.value)}
                  rows={4}
                  disabled={status === 'generating'}
                />
              </label>

              <label className="marketing-field">
                <span>Titulo del Reel</span>
                <input
                  type="text"
                  placeholder="Ej: Automatiza tu negocio con NoyeCode"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={status === 'generating'}
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
                  disabled={status === 'generating'}
                />
              </label>
            </>
          )}

          {mode === 'manual' && (
            <>
              <div className="reel-modal__specs">
                <span className="reel-modal__specs-title">Requisitos del Reel</span>
                <div className="reel-modal__specs-grid">
                  <span>Formato: <strong>MP4 (H.264)</strong></span>
                  <span>Orientacion: <strong>Vertical 9:16</strong></span>
                  <span>Resolucion: <strong>1080x1920 recomendado</strong></span>
                  <span>Minimo: <strong>540x960</strong></span>
                  <span>Duracion: <strong>3s - 90s</strong></span>
                  <span>Tamano max: <strong>1GB</strong></span>
                </div>
              </div>

              {!token && (
                <div className="reel-modal__warning">
                  La empresa seleccionada no tiene token de Facebook configurado.
                </div>
              )}

              <div
                className={`reel-modal__dropzone ${videoFile ? (warnings.length > 0 ? 'reel-modal__dropzone--error' : 'reel-modal__dropzone--has-file') : ''}`}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,.mp4,.mov"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                {videoFile ? (
                  <div className="reel-modal__file-info">
                    <span className="reel-modal__file-icon">&#127916;</span>
                    <div className="reel-modal__file-details">
                      <span className="reel-modal__file-name">{videoFile.name}</span>
                      {videoMeta && (
                        <span className="reel-modal__file-meta">
                          {videoMeta.width}x{videoMeta.height} | {Math.round(videoMeta.duration)}s | {(videoFile.size / 1024 / 1024).toFixed(1)}MB
                          {videoMeta.height > videoMeta.width ? ' | Vertical' : ' | Horizontal'}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="reel-modal__drop-text">
                    <span className="reel-modal__drop-icon">&#128249;</span>
                    <span>Click para seleccionar video</span>
                    <small>MP4 vertical 9:16 | 1080x1920 | 3-90 segundos</small>
                  </div>
                )}
              </div>

              {warnings.length > 0 && (
                <div className="reel-modal__warning">
                  {warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </div>
              )}

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
            </>
          )}

          {message && (
            <div className={`reel-modal__message reel-modal__message--${status}`}>
              {message}
            </div>
          )}
        </div>

        <div className="reel-modal__footer">
          {mode === 'bot' && (
            <button
              className="btn btn--reel-publish"
              disabled={!canStartBot}
              onClick={handleStartBot}
            >
              {status === 'generating' ? 'Generando...' : 'Iniciar Bot Reel'}
            </button>
          )}
          {mode === 'manual' && (
            <button
              className="btn btn--reel-publish"
              disabled={!canPublishManual}
              onClick={handlePublishManual}
            >
              {status === 'uploading' ? 'Publicando...' : 'Publicar Reel'}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
