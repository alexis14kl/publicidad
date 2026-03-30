import { useEffect, useRef, useState, useMemo } from 'react'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  status?: 'pending' | 'running' | 'done' | 'error' | 'preview'
  preview?: PreviewData | null
}

interface PreviewData {
  type: 'image' | 'video' | 'campaign'
  imagePath?: string
  imageDataUrl?: string
  videoDataUrl?: string
  campaignSpec?: Record<string, unknown>
  summary: string
}

const api = () => window.electronAPI

function Typewriter({ text, speed = 40 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState('')
  const indexRef = useRef(0)

  useEffect(() => {
    setDisplayed('')
    indexRef.current = 0
    const interval = setInterval(() => {
      indexRef.current++
      setDisplayed(text.slice(0, indexRef.current))
      if (indexRef.current >= text.length) clearInterval(interval)
    }, speed)
    return () => clearInterval(interval)
  }, [text, speed])

  return <>{displayed}</>
}

export function ChatBotPage() {
  const [videoModal, setVideoModal] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '__welcome__',
      timestamp: Date.now(),
    },
  ])
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [awaitingApproval, setAwaitingApproval] = useState<string | null>(null)
  const [approvalStep, setApprovalStep] = useState<'extend' | 'publish'>('extend')
  const [lastPreviewType, setLastPreviewType] = useState<string | null>(null)
  const [extendPrompt, setExtendPrompt] = useState('')
  const [hasMoreScenes, setHasMoreScenes] = useState(false)
  const [nextScenePreview, setNextScenePreview] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const extendInputRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const unsub = api().onBotLogLines((lines: string[]) => {
      if (!isProcessing) return
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('[DEBUG]')) {
          updateMessages(prev => [...prev, {
            id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            role: 'system',
            content: trimmed,
            timestamp: Date.now(),
            status: 'running',
          }])
        }
      }
    })
    return unsub
  }, [isProcessing])

  function updateMessages(fn: (prev: ChatMessage[]) => ChatMessage[]) {
    setMessages(fn)
  }

  function addMsg(role: ChatMessage['role'], content: string, status?: ChatMessage['status'], preview?: PreviewData | null) {
    updateMessages(prev => [...prev, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role,
      content,
      timestamp: Date.now(),
      status,
      preview: preview || null,
    }])
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || isProcessing) return

    setInput('')
    addMsg('user', text)
    setIsProcessing(true)

    try {
      addMsg('assistant', 'Analizando tu solicitud...', 'pending')

      const result = await (api() as any).chatCommand(text)

      // Remove pending message
      updateMessages(prev => prev.filter(m => m.status !== 'pending'))

      if (result.success) {
        if (result.needsApproval) {
          // Show preview and wait for user approval
          setAwaitingApproval(result.jobId || 'pending')
          const previewType = result.preview?.type || 'image'
          setLastPreviewType(previewType)
          setApprovalStep(previewType === 'video' ? 'extend' : 'publish')
          setHasMoreScenes(!!result.hasMoreScenes)
          setNextScenePreview(result.nextScenePreview || '')
          addMsg('assistant', result.message, 'preview', result.preview || null)
        } else {
          addMsg('assistant', result.message || 'Listo.', 'done')
        }
        if (result.details) {
          addMsg('system', result.details, 'done')
        }
      } else {
        addMsg('assistant', result.error || 'No pude completar la solicitud.', 'error')
      }
    } catch (err: any) {
      updateMessages(prev => prev.filter(m => m.status !== 'pending'))
      addMsg('assistant', `Error: ${err.message || err}`, 'error')
    } finally {
      setIsProcessing(false)
      inputRef.current?.focus()
    }
  }

  async function handleApprove() {
    if (!awaitingApproval) return

    setAwaitingApproval(null)
    setIsProcessing(true)
    addMsg('user', 'Aprobado. Publicar.')
    addMsg('assistant', 'Publicando...', 'pending')

    try {
      const result = await (api() as any).chatApprove(awaitingApproval)

      updateMessages(prev => prev.filter(m => m.status !== 'pending'))

      if (result.success) {
        addMsg('assistant', result.message || 'Publicado exitosamente.', 'done')
      } else {
        addMsg('assistant', result.error || 'Error al publicar.', 'error')
      }
    } catch (err: any) {
      updateMessages(prev => prev.filter(m => m.status !== 'pending'))
      addMsg('assistant', `Error: ${err.message || err}`, 'error')
    } finally {
      setIsProcessing(false)
    }
  }

  function handleReject() {
    setAwaitingApproval(null)
    setApprovalStep('extend')
    setLastPreviewType(null)
    setExtendPrompt('')
    addMsg('user', 'Rechazado. No publicar.')
    addMsg('assistant', 'Entendido. El contenido no se publicará. Puedes darme más detalles o empezar algo nuevo.', 'done')
  }

  async function handleExtendVideo(customPrompt?: string) {
    if (!awaitingApproval) return
    // customPrompt = prompt manual del textarea; vacío = usar escena pre-generada
    const prompt = (customPrompt || extendPrompt || '').trim()

    setIsProcessing(true)
    setExtendPrompt('')

    if (prompt) {
      addMsg('user', `Extender video: ${prompt}`)
    } else {
      addMsg('user', 'Aprobar siguiente escena')
    }
    addMsg('assistant', 'Generando extensión de video en Google Flow...', 'pending')

    try {
      // Pasar prompt vacío si es escena automática — el backend usa la pre-generada
      const result = await (api() as any).chatExtendVideo(awaitingApproval, prompt)
      updateMessages(prev => prev.filter(m => m.status !== 'pending'))

      if (result.success) {
        setAwaitingApproval(result.jobId || 'pending')
        setApprovalStep('extend')
        setHasMoreScenes(!!result.hasMoreScenes)
        setNextScenePreview(result.nextScenePreview || '')
        addMsg('assistant', result.message, 'preview', result.preview || null)
      } else {
        addMsg('assistant', result.error || 'Error al extender el video.', 'error')
      }
    } catch (err: any) {
      updateMessages(prev => prev.filter(m => m.status !== 'pending'))
      addMsg('assistant', `Error: ${err.message || err}`, 'error')
    } finally {
      setIsProcessing(false)
    }
  }

  function handleContinueToPublish() {
    setApprovalStep('publish')
  }

  async function handleNewConversation() {
    await (api() as any).chatReset()
    setAwaitingApproval(null)
    setApprovalStep('extend')
    setLastPreviewType(null)
    setExtendPrompt('')
    setIsProcessing(false)
    setMessages([{
      id: `new-${Date.now()}`,
      role: 'assistant',
      content: 'Nueva conversación iniciada. ¿Qué quieres crear?',
      timestamp: Date.now(),
    }])
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function formatTime(ts: number) {
    return new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  }

  const [expandedLogGroups, setExpandedLogGroups] = useState<Set<string>>(new Set())

  // Group consecutive system messages into blocks
  type RenderItem =
    | { type: 'msg'; msg: ChatMessage }
    | { type: 'log-group'; id: string; msgs: ChatMessage[] }

  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = []
    let currentGroup: ChatMessage[] = []

    const flushGroup = () => {
      if (currentGroup.length === 0) return
      if (currentGroup.length === 1) {
        items.push({ type: 'msg', msg: currentGroup[0] })
      } else {
        items.push({ type: 'log-group', id: currentGroup[0].id, msgs: [...currentGroup] })
      }
      currentGroup = []
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        currentGroup.push(msg)
      } else {
        flushGroup()
        items.push({ type: 'msg', msg })
      }
    }
    flushGroup()
    return items
  }, [messages])

  function toggleLogGroup(id: string) {
    setExpandedLogGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="chatbot-page">
      <div className="chatbot-messages">
        {renderItems.map((item) => {
          if (item.type === 'log-group') {
            const expanded = expandedLogGroups.has(item.id)
            const lastMsg = item.msgs[item.msgs.length - 1]
            return (
              <div key={item.id} className="chatbot-log-group">
                <button
                  className="chatbot-log-group__toggle"
                  onClick={() => toggleLogGroup(item.id)}
                >
                  <span className={`chatbot-log-group__chevron ${expanded ? 'chatbot-log-group__chevron--open' : ''}`}>&#9654;</span>
                  <span className="chatbot-log-group__label">
                    {expanded ? 'Ocultar logs' : `${item.msgs.length} pasos del proceso`}
                  </span>
                  <span className="chatbot-log-group__time">{formatTime(lastMsg.timestamp)}</span>
                </button>
                {expanded && (
                  <div className="chatbot-log-group__body">
                    {item.msgs.map((m) => (
                      <div key={m.id} className="chatbot-log-group__line">{m.content}</div>
                    ))}
                  </div>
                )}
              </div>
            )
          }

          const msg = item.msg

          // Welcome card
          if (msg.content === '__welcome__') {
            return (
              <div key={msg.id} className="chatbot-welcome">
                <div className="chatbot-welcome__header">
                  <div className="chatbot-welcome__avatar">
                    <span>&#10024;</span>
                  </div>
                  <div>
                    <h3 className="chatbot-welcome__title">Hola, soy tu asistente</h3>
                    <p className="chatbot-welcome__subtitle">Cuéntame qué necesitas y yo me encargo de todo</p>
                  </div>
                </div>
                <div className="chatbot-welcome__cards">
                  <button className="chatbot-welcome__card" onClick={() => { setInput('Genera una imagen publicitaria para '); inputRef.current?.focus() }}>
                    <span className="chatbot-welcome__card-icon">&#127912;</span>
                    <div>
                      <strong>Imagen publicitaria</strong>
                      <span>Descríbela y la genero</span>
                    </div>
                  </button>
                  <button className="chatbot-welcome__card" onClick={() => { setInput('Crea un video/reel sobre '); inputRef.current?.focus() }}>
                    <span className="chatbot-welcome__card-icon">&#127916;</span>
                    <div>
                      <strong>Video / Reel</strong>
                      <span>Descríbelo y lo creo</span>
                    </div>
                  </button>
                  <button className="chatbot-welcome__card" onClick={() => { setInput('Arma una campaña de Meta Ads para '); inputRef.current?.focus() }}>
                    <span className="chatbot-welcome__card-icon">&#128640;</span>
                    <div>
                      <strong>Campaña de Meta Ads</strong>
                      <span>Dame el concepto y armo todo</span>
                    </div>
                  </button>
                </div>
                <p className="chatbot-welcome__footer">
                  Solo escribe lo que quieres. Yo defino la audiencia, segmentación, copy y creativos automáticamente.
                </p>
              </div>
            )
          }

          // Pending message → show as thinking indicator
          if (msg.status === 'pending') {
            return (
              <div key={msg.id} className="chatbot-msg chatbot-msg--assistant chatbot-msg--pending">
                <div className="chatbot-msg__bubble chatbot-thinking-bubble">
                  <span className="chatbot-thinking-bubble__text"><Typewriter text={msg.content} speed={35} /></span>
                  <span className="chatbot-thinking-bubble__dots">
                    <span></span><span></span><span></span>
                  </span>
                </div>
              </div>
            )
          }

          return (
            <div key={msg.id} className={`chatbot-msg chatbot-msg--${msg.role} ${msg.status ? `chatbot-msg--${msg.status}` : ''}`}>
              <div className="chatbot-msg__bubble">
                <div className="chatbot-msg__content" dangerouslySetInnerHTML={{
                  __html: msg.content
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\n/g, '<br/>')
                }} />
                {msg.preview?.videoDataUrl && (
                  <button
                    className="chatbot-video-thumb"
                    onClick={() => setVideoModal(msg.preview?.videoDataUrl || null)}
                  >
                    <span className="chatbot-video-thumb__icon">&#9654;</span>
                    <span className="chatbot-video-thumb__label">Ver video generado</span>
                  </button>
                )}
                {msg.preview?.imageDataUrl && !msg.preview?.videoDataUrl && (
                  <img
                    className="chatbot-preview-img"
                    src={msg.preview.imageDataUrl}
                    alt="Preview"
                  />
                )}
                {msg.preview?.imagePath && !msg.preview?.imageDataUrl && !msg.preview?.videoDataUrl && (
                  <div className="chatbot-preview-summary">Archivo generado: {msg.preview.imagePath.split('/').pop()}</div>
                )}
                {msg.preview?.summary && (
                  <div className="chatbot-preview-summary">{msg.preview.summary}</div>
                )}
                <span className="chatbot-msg__time">{formatTime(msg.timestamp)}</span>
              </div>
            </div>
          )
        })}

        {awaitingApproval && approvalStep === 'extend' && lastPreviewType === 'video' && (
          <div className="chatbot-extend-section">
            {hasMoreScenes ? (
              <>
                <div className="chatbot-next-scene">
                  <span className="chatbot-next-scene-label">Siguiente escena:</span>
                  <span className="chatbot-next-scene-text">{nextScenePreview}</span>
                </div>
                <div className="chatbot-approval">
                  <button className="chatbot-extend" onClick={() => handleExtendVideo('')} disabled={isProcessing}>
                    Aprobar escena
                  </button>
                  <button className="chatbot-continue" onClick={handleContinueToPublish} disabled={isProcessing}>
                    Publicar ahora
                  </button>
                </div>
              </>
            ) : (
              <>
                <textarea
                  ref={extendInputRef}
                  className="chatbot-extend-input"
                  value={extendPrompt}
                  onChange={e => setExtendPrompt(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleExtendVideo()
                    }
                  }}
                  placeholder="Describe qué pasa después en el video..."
                  disabled={isProcessing}
                  rows={2}
                />
                <div className="chatbot-approval">
                  <button className="chatbot-extend" onClick={() => handleExtendVideo()} disabled={isProcessing || !extendPrompt.trim()}>
                    Extender video
                  </button>
                  <button className="chatbot-continue" onClick={handleContinueToPublish} disabled={isProcessing}>
                    Publicar ahora
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {awaitingApproval && approvalStep === 'publish' && (
          <div className="chatbot-approval">
            <button className="chatbot-approve" onClick={handleApprove} disabled={isProcessing}>
              Aprobar y publicar
            </button>
            <button className="chatbot-reject" onClick={handleReject} disabled={isProcessing}>
              Rechazar
            </button>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      <div className="chatbot-toolbar">
        <button className="chatbot-new-btn" onClick={handleNewConversation} disabled={isProcessing}>
          Nueva conversación
        </button>
      </div>
      <div className="chatbot-input-area">
        <textarea
          ref={inputRef}
          className="chatbot-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            awaitingApproval
              ? 'Aprueba o rechaza el contenido generado...'
              : isProcessing
                ? 'Generando...'
                : 'Describe lo que quieres crear...'
          }
          disabled={isProcessing || !!awaitingApproval}
          rows={1}
        />
        <button
          className="chatbot-send"
          onClick={handleSend}
          disabled={!input.trim() || isProcessing || !!awaitingApproval}
        >
          {isProcessing ? '...' : '→'}
        </button>
      </div>

      {videoModal && (
        <div className="chatbot-video-modal-backdrop" onClick={() => setVideoModal(null)}>
          <div className="chatbot-video-modal" onClick={e => e.stopPropagation()}>
            <button className="chatbot-video-modal__close" onClick={() => setVideoModal(null)}>✕</button>
            <video
              className="chatbot-video-modal__player"
              src={videoModal}
              controls
              autoPlay
              playsInline
            />
          </div>
        </div>
      )}
    </div>
  )
}
