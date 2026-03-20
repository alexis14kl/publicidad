import { useRef, useState } from 'react'
import type { CompanyRecord } from '../shared/api/types'
import { startBot } from '../shared/api/commands'

const WEBHOOK_URL = 'https://n8n-dev.noyecode.com/webhook/publicar-reel-fb'

const REEL_REQUIREMENTS = {
  minWidth: 540,
  minHeight: 960,
  maxSizeMB: 1024,
  maxDurationSec: 90,
  minDurationSec: 3,
  formats: ['video/mp4', 'video/quicktime', 'video/x-m4v'],
}

interface VideoTabContentProps {
  companies: CompanyRecord[]
  selectedCompany: string
  disabled: boolean
  videoPrompt: string
  onChangeVideoPrompt: (value: string) => void
  videoTitle: string
  onChangeVideoTitle: (value: string) => void
  videoCaption: string
  onChangeVideoCaption: (value: string) => void
}

export function VideoTabContent({
  companies,
  selectedCompany,
  disabled,
  videoPrompt,
  onChangeVideoPrompt,
  videoTitle,
  onChangeVideoTitle,
  videoCaption,
  onChangeVideoCaption,
}: VideoTabContentProps) {
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

  const title = videoTitle
  const caption = videoCaption
  const canStartBot = !!videoPrompt.trim() && status !== 'generating' && status !== 'uploading'
  const canPublishManual = !!videoFile && !!videoMeta && !!token && !!pageId && status !== 'uploading' && warnings.length === 0

  const validateVideo = (file: File, meta: { width: number; height: number; duration: number }) => {
    const issues: string[] = []
    const sizeMB = file.size / (1024 * 1024)
    if (sizeMB > REEL_REQUIREMENTS.maxSizeMB) issues.push(`Tamano excede ${REEL_REQUIREMENTS.maxSizeMB}MB`)
    if (meta.duration > REEL_REQUIREMENTS.maxDurationSec) issues.push(`Duracion excede ${REEL_REQUIREMENTS.maxDurationSec}s`)
    if (meta.duration < REEL_REQUIREMENTS.minDurationSec) issues.push(`Duracion minima ${REEL_REQUIREMENTS.minDurationSec}s`)
    if (meta.width > meta.height) issues.push(`Video horizontal. Los Reels deben ser verticales 9:16`)
    if (meta.height < REEL_REQUIREMENTS.minHeight) issues.push(`Altura minima ${REEL_REQUIREMENTS.minHeight}px`)
    if (meta.width < REEL_REQUIREMENTS.minWidth) issues.push(`Ancho minimo ${REEL_REQUIREMENTS.minWidth}px`)
    if (!REEL_REQUIREMENTS.formats.includes(file.type) && !file.name.toLowerCase().endsWith('.mp4'))
      issues.push(`Formato no soportado. Usa MP4 o MOV`)
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
      const meta = { width: video.videoWidth, height: video.videoHeight, duration: video.duration }
      setVideoMeta(meta)
      setWarnings(validateVideo(file, meta))
      setVideoFile(file)
      setMessage(`${file.name} | ${meta.width}x${meta.height} | ${Math.round(meta.duration)}s | ${(file.size / 1024 / 1024).toFixed(1)}MB`)
      URL.revokeObjectURL(video.src)
    }
    video.onerror = () => {
      setVideoFile(null)
      setVideoMeta(null)
      setWarnings(['No se pudo leer el video'])
      URL.revokeObjectURL(video.src)
    }
    video.src = URL.createObjectURL(file)
  }

  const handleStartBot = async () => {
    if (!canStartBot) return
    setStatus('generating')
    setMessage('Iniciando bot de video con DiCloak + Flow (Veo 3)...')
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
      const response = await fetch(WEBHOOK_URL, { method: 'POST', body: formData })
      const data = await response.json()
      if (data.status === 'success') {
        setStatus('success')
        setMessage(`Reel publicado. Post ID: ${data.post_id || 'procesando'}`)
      } else {
        setStatus('error')
        setMessage(`Error: ${data.message || 'No se pudo publicar'}`)
      }
    } catch (err) {
      setStatus('error')
      setMessage(`Error: ${err instanceof Error ? err.message : 'desconocido'}`)
    }
  }

  return (
    <div className="tab-content">
      <div className="tab-content__mode-tabs">
        <button
          className={`tab-content__mode-tab ${mode === 'bot' ? 'tab-content__mode-tab--active' : ''}`}
          onClick={() => setMode('bot')}
          disabled={disabled || status === 'uploading' || status === 'generating'}
        >
          Generar con IA
        </button>
        <button
          className={`tab-content__mode-tab ${mode === 'manual' ? 'tab-content__mode-tab--active' : ''}`}
          onClick={() => setMode('manual')}
          disabled={disabled || status === 'uploading' || status === 'generating'}
        >
          Subir video manual
        </button>
      </div>

      {mode === 'bot' && (
        <>
          <div className="tab-content__controls">
            <div className="format-select">
              <label className="format-select__label" htmlFor="reel-title">Titulo del Reel</label>
              <input
                id="reel-title"
                className="format-select__input"
                type="text"
                placeholder="Ej: Automatiza tu negocio con NoyeCode"
                value={title}
                onChange={(e) => onChangeVideoTitle(e.target.value)}
                disabled={disabled || status === 'generating'}
              />
            </div>
            <div className="format-select">
              <label className="format-select__label" htmlFor="reel-caption">Caption / Descripcion</label>
              <input
                id="reel-caption"
                className="format-select__input"
                type="text"
                placeholder="Texto que acompanara tu reel..."
                value={caption}
                onChange={(e) => onChangeVideoCaption(e.target.value)}
                disabled={disabled || status === 'generating'}
              />
            </div>
          </div>
          <label className="control-prompt">
            <span className="control-prompt__label">Prompt del video</span>
            <textarea
              className="control-prompt__input"
              placeholder="Escribe tu idea para el video... Ej: 'Video promocional de 15 segundos mostrando automatizacion empresarial con transiciones dinamicas'"
              value={videoPrompt}
              onChange={(e) => onChangeVideoPrompt(e.target.value)}
              rows={4}
              disabled={disabled || status === 'generating'}
            />
          </label>
          <span className="control-prompt__hint">
            Usa el boton "Iniciar Bot" del panel de control para generar el video.
          </span>
        </>
      )}

      {mode === 'manual' && (
        <>
          <div className="reel-modal__specs">
            <span className="reel-modal__specs-title">Requisitos del Reel</span>
            <div className="reel-modal__specs-grid">
              <span>Formato: <strong>MP4 (H.264)</strong></span>
              <span>Orientacion: <strong>Vertical 9:16</strong></span>
              <span>Resolucion: <strong>1080x1920</strong></span>
              <span>Duracion: <strong>3s - 90s</strong></span>
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
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="reel-modal__drop-text">
                <span className="reel-modal__drop-icon">&#128249;</span>
                <span>Click para seleccionar video</span>
              </div>
            )}
          </div>
          {warnings.length > 0 && (
            <div className="reel-modal__warning">
              {warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          )}
          <div className="tab-content__controls">
            <div className="format-select">
              <label className="format-select__label" htmlFor="reel-title-manual">Titulo del Reel</label>
              <input
                id="reel-title-manual"
                className="format-select__input"
                type="text"
                placeholder="Ej: Automatiza tu negocio con NoyeCode"
                value={title}
                onChange={(e) => onChangeVideoTitle(e.target.value)}
                disabled={disabled || status === 'uploading'}
              />
            </div>
            <div className="format-select">
              <label className="format-select__label" htmlFor="reel-caption-manual">Caption / Descripcion</label>
              <input
                id="reel-caption-manual"
                className="format-select__input"
                type="text"
                placeholder="Texto que acompanara tu reel..."
                value={caption}
                onChange={(e) => onChangeVideoCaption(e.target.value)}
                disabled={disabled || status === 'uploading'}
              />
            </div>
          </div>
          <button
            className="btn btn--reel-publish"
            disabled={!canPublishManual || disabled}
            onClick={handlePublishManual}
          >
            {status === 'uploading' ? 'Publicando...' : 'Publicar Reel'}
          </button>
        </>
      )}

      {message && (
        <div className={`reel-modal__message reel-modal__message--${status}`}>
          {message}
        </div>
      )}
    </div>
  )
}
