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

  const isExecuting = botStatus.status === 'executing'

  const handleStartBot = async () => {
    setBotLoading(true)
    try {
      await startBot()
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
          <div className="control-buttons">
            <button
              className="btn btn--start"
              onClick={handleStartBot}
              disabled={isExecuting || botLoading}
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
