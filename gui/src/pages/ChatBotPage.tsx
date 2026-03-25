import { useEffect, useRef, useState } from 'react'

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
  imageUrl?: string
  campaignSpec?: Record<string, unknown>
  summary: string
  publishTarget?: string
  jobId?: string
}

const api = () => window.electronAPI

export function ChatBotPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '¡Hola! Soy tu asistente de publicidad.\n\nCuéntame qué necesitas y yo me encargo de todo:\n\n'
        + '• **Imagen publicitaria** — Descríbela y la genero\n'
        + '• **Video / Reel** — Descríbelo y lo creo\n'
        + '• **Campaña de Meta Ads** — Dame el concepto y armo todo\n\n'
        + 'Solo escribe lo que quieres. Yo defino la audiencia, segmentación, copy y creativos automáticamente.',
      timestamp: Date.now(),
    },
  ])
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [awaitingApproval, setAwaitingApproval] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
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
    addMsg('user', 'Rechazado. No publicar.')
    addMsg('assistant', 'Entendido. El contenido no se publicará. Puedes darme más detalles o empezar algo nuevo.', 'done')
  }

  async function handleNewConversation() {
    await (api() as any).chatReset()
    setAwaitingApproval(null)
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

  return (
    <div className="chatbot-page">
      <div className="chatbot-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chatbot-msg chatbot-msg--${msg.role} ${msg.status ? `chatbot-msg--${msg.status}` : ''}`}>
            <div className="chatbot-msg__bubble">
              <div className="chatbot-msg__content" dangerouslySetInnerHTML={{
                __html: msg.content
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  .replace(/\n/g, '<br/>')
              }} />
              {msg.preview?.imagePath && (
                <img
                  className="chatbot-preview-img"
                  src={`file://${msg.preview.imagePath}`}
                  alt="Preview"
                />
              )}
              {msg.preview?.summary && (
                <div className="chatbot-preview-summary">{msg.preview.summary}</div>
              )}
              <span className="chatbot-msg__time">{formatTime(msg.timestamp)}</span>
            </div>
          </div>
        ))}

        {awaitingApproval && (
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
    </div>
  )
}
