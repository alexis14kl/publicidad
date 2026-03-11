import { useEffect, useRef, useState } from 'react'
import { GlassCard } from './GlassCard'

interface LogViewerProps {
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
  return { text: line, className: '' }
}

// Strip ANSI escape codes for display
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

export function LogViewer({ lines, onClear }: LogViewerProps) {
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
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 40
    setAutoScroll(isNearBottom)
  }

  return (
    <GlassCard className="log-viewer">
      <div className="log-header">
        <div className="card-header">
          <span className="card-icon">&#128196;</span>
          <span className="card-title">Logs</span>
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
    </GlassCard>
  )
}
