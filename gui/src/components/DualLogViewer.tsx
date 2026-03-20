import { useEffect, useRef, useState } from 'react'

interface LogPanelProps {
  title: string
  icon: string
  lines: string[]
  onClear: () => void
}

function colorize(line: string): { text: string; className: string } {
  if (line.includes('[OK]') || line.includes('[ok]')) return { text: line, className: 'log-ok' }
  if (line.includes('[ERROR]') || line.includes('[error]') || line.includes('ERROR')) return { text: line, className: 'log-error' }
  if (line.includes('[WARN]') || line.includes('[warn]') || line.includes('WARNING')) return { text: line, className: 'log-warn' }
  if (line.includes('[INFO]') || line.includes('[info]')) return { text: line, className: 'log-info' }
  if (line.includes('[DEBUG]') || line.includes('[debug]')) return { text: line, className: 'log-debug' }
  if (/^\[?\d+\/\d+\]/.test(line.trim())) return { text: line, className: 'log-step' }
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
      <div ref={containerRef} className="log-content" onScroll={handleScroll}>
        {lines.length === 0 ? (
          <p className="no-data">Sin logs disponibles</p>
        ) : (
          lines.map((line, i) => {
            const { text, className } = colorize(stripAnsi(line))
            return (
              <div key={i} className={`log-line ${className}`}>{text}</div>
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
}

export function DualLogViewer({ workerLines, onClearWorker, botLines, onClearBot }: DualLogViewerProps) {
  return (
    <div className="dual-log-viewer glass-card">
      <div className="dual-log-viewer__terminals">
        <LogPanel title="Worker (Poller)" icon="&#9881;" lines={workerLines} onClear={onClearWorker} />
        <div className="log-divider" />
        <LogPanel title="Bot Terminal" icon="&#9654;" lines={botLines} onClear={onClearBot} />
      </div>
    </div>
  )
}
