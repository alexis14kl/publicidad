import { useState } from 'react'
import { GlassCard } from './GlassCard'
import { startBot, stopBot } from '../lib/commands'
import type { BotStatus } from '../lib/types'

interface ControlPanelProps {
  botStatus: BotStatus
  pollerRunning: boolean
  pollerLoading: boolean
  onStartPoller: () => void
  onStopPoller: () => void
}

export function ControlPanel({
  botStatus,
  pollerRunning,
  pollerLoading,
  onStartPoller,
  onStopPoller,
}: ControlPanelProps) {
  const [botLoading, setBotLoading] = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')

  const isExecuting = botStatus.status === 'executing'
  const canStartBot = !isExecuting && !botLoading && !!imagePrompt.trim()

  const handleStartBot = async () => {
    if (!imagePrompt.trim()) return
    setBotLoading(true)
    try {
      await startBot({ imagePrompt: imagePrompt.trim() })
    } finally {
      setBotLoading(false)
    }
  }

  const handleStopBot = async () => {
    setBotLoading(true)
    try {
      await stopBot()
    } finally {
      setBotLoading(false)
    }
  }

  return (
    <GlassCard className="control-panel">
      <div className="card-header">
        <span className="card-icon">&#9654;</span>
        <span className="card-title">Control</span>
      </div>
      <div className="control-grid">
        <div className="control-section">
          <span className="control-label">Bot</span>
          <label className="control-prompt">
            <span className="control-prompt__label">Prompt de imagen</span>
            <textarea
              className="control-prompt__input"
              placeholder="Ingresa aqui el prompt que el bot usara para generar la imagen..."
              value={imagePrompt}
              onChange={(event) => setImagePrompt(event.target.value)}
              rows={4}
              disabled={isExecuting || botLoading}
            />
          </label>
          <div className="control-buttons">
            <button
              className="btn btn--start"
              onClick={handleStartBot}
              disabled={!canStartBot}
            >
              {botLoading ? 'Iniciando...' : 'Iniciar Bot'}
            </button>
            <button
              className="btn btn--stop"
              onClick={handleStopBot}
              disabled={!isExecuting || botLoading}
            >
              Detener Bot
            </button>
          </div>
          <span className="control-prompt__hint">
            Antes de iniciar, escribe el prompt visual que quieres usar para la generacion de imagenes.
          </span>
        </div>
        <div className="control-section">
          <span className="control-label">Poller</span>
          <div className="control-buttons">
            <button
              className="btn btn--start"
              onClick={onStartPoller}
              disabled={pollerRunning || pollerLoading}
            >
              {pollerLoading ? 'Iniciando...' : 'Iniciar Poller'}
            </button>
            <button
              className="btn btn--stop"
              onClick={onStopPoller}
              disabled={!pollerRunning || pollerLoading}
            >
              Detener Poller
            </button>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}
