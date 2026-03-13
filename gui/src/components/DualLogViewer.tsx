import { useEffect, useRef, useState } from 'react'

interface LogPanelProps {
  title: string
  icon: string
  lines: string[]
  onClear: () => void
}

function colorize(line: string): { text: string; className: string } {
  if (line.includes('[OK]') || line.includes('[ok]')) {
    return { text: line, className: 'log-ok' }
  }
  if (line.includes('[ERROR]') || line.includes('[error]') || line.includes('ERROR')) {
    return { text: line, className: 'log-error' }
  }
  if (line.includes('[WARN]') || line.includes('[warn]') || line.includes('WARNING')) {
    return { text: line, className: 'log-warn' }
  }
  if (line.includes('[INFO]') || line.includes('[info]')) {
    return { text: line, className: 'log-info' }
  }
  if (line.includes('[DEBUG]') || line.includes('[debug]')) {
    return { text: line, className: 'log-debug' }
  }
  // Step labels like [1/10], [2/10]
  if (/^\[?\d+\/\d+\]/.test(line.trim())) {
    return { text: line, className: 'log-step' }
  }
  return { text: line, className: '' }
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

function LogPanel({ title, icon, lines, onClear }: LogPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40)
  }

  return (
    <div className="log-panel">
      <div className="log-header">
        <div className="card-header">
          <span className="card-icon">{icon}</span>
          <span className="card-title">{title}</span>
          <span className="log-count">{lines.length} lineas</span>
        </div>
        <button className="btn btn--small btn--ghost" onClick={onClear}>
          Limpiar
        </button>
      </div>
      <div
        ref={containerRef}
        className="log-content"
        onScroll={handleScroll}
      >
        {lines.length === 0 ? (
          <p className="no-data">Sin logs disponibles</p>
        ) : (
          lines.map((line, i) => {
            const { text, className } = colorize(stripAnsi(line))
            return (
              <div key={i} className={`log-line ${className}`}>
                {text}
              </div>
            )
          })
        )}
      </div>
      {!autoScroll && (
        <button
          className="btn btn--small btn--scroll-bottom"
          onClick={() => {
            setAutoScroll(true)
            containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' })
          }}
        >
          &#8595; Ir al final
        </button>
      )}
    </div>
  )
}

interface DualLogViewerProps {
  workerLines: string[]
  onClearWorker: () => void
  botLines: string[]
  onClearBot: () => void
  imagePrompt: string
  onChangeImagePrompt: (value: string) => void
  imagePromptHistory: string[]
  promptDisabled: boolean
}

export function DualLogViewer({
  workerLines,
  onClearWorker,
  botLines,
  onClearBot,
  imagePrompt,
  onChangeImagePrompt,
  imagePromptHistory,
  promptDisabled,
}: DualLogViewerProps) {
  const [activeTab, setActiveTab] = useState<'terminals' | 'prompt'>('terminals')
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!historyOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (historyRef.current && !historyRef.current.contains(target)) {
        setHistoryOpen(false)
      }
    }
    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [historyOpen])

  return (
    <div className="dual-log-viewer glass-card">
      <div className="dual-log-viewer__content">
        {activeTab === 'terminals' ? (
          <div className="dual-log-viewer__terminals">
            <LogPanel
              title="Worker (Poller)"
              icon="&#9881;"
              lines={workerLines}
              onClear={onClearWorker}
            />
            <div className="log-divider" />
            <LogPanel
              title="Bot Terminal"
              icon="&#9654;"
              lines={botLines}
              onClear={onClearBot}
            />
          </div>
        ) : (
          <div className="prompt-tab">
            <div className="prompt-tab__header">
              <div className="card-header">
                <span className="card-icon">&#128247;</span>
                <span className="card-title">Prompt de imagen</span>
              </div>
              <div ref={historyRef} className="prompt-tab__history">
                <button
                  className="btn btn--small btn--ghost"
                  onClick={() => setHistoryOpen((v) => !v)}
                  disabled={imagePromptHistory.length === 0}
                  title={imagePromptHistory.length === 0 ? 'No hay prompts guardados' : 'Ver ultimos 10 prompts'}
                >
                  Historial
                </button>
                {historyOpen && (
                  <div className="prompt-history" role="menu" aria-label="Historial de prompts">
                    {imagePromptHistory.slice(0, 10).map((prompt, index) => (
                      <button
                        key={`${index}-${prompt}`}
                        className="prompt-history__item"
                        onClick={() => {
                          onChangeImagePrompt(prompt)
                          setHistoryOpen(false)
                        }}
                        type="button"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <label className="control-prompt">
              <span className="control-prompt__label">Prompt</span>
              <textarea
                className="control-prompt__input"
                placeholder="Ingresa aqui el prompt que el bot usara para generar la imagen..."
                value={imagePrompt}
                onChange={(event) => onChangeImagePrompt(event.target.value)}
                rows={4}
                disabled={promptDisabled}
              />
            </label>
            <span className="control-prompt__hint">
              Puedes seleccionar un prompt anterior desde el historial.
            </span>
          </div>
        )}
      </div>

      <div className="terminal-tabs" role="tablist" aria-label="Terminales">
        <button
          className={`terminal-tab ${activeTab === 'terminals' ? 'terminal-tab--active' : ''}`}
          onClick={() => {
            setActiveTab('terminals')
            setHistoryOpen(false)
          }}
          role="tab"
          aria-selected={activeTab === 'terminals'}
          type="button"
        >
          Terminales
        </button>
        <button
          className={`terminal-tab ${activeTab === 'prompt' ? 'terminal-tab--active' : ''}`}
          onClick={() => setActiveTab('prompt')}
          role="tab"
          aria-selected={activeTab === 'prompt'}
          type="button"
        >
          Prompt de imagen
        </button>
      </div>
    </div>
  )
}
