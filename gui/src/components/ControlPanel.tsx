import { GlassCard } from './GlassCard'
import type { BotStatus } from '../lib/types'

interface ControlPanelProps {
  botStatus: BotStatus
  botLoading: boolean
  imagePrompt: string
  hasCompany: boolean
  pollerRunning: boolean
  pollerLoading: boolean
  onStartPoller: () => void
  onStopPoller: () => void
  onStartBot: () => void
  onStopBot: () => void
}

export function ControlPanel({
  botStatus,
  botLoading,
  imagePrompt,
  hasCompany,
  pollerRunning,
  pollerLoading,
  onStartPoller,
  onStopPoller,
  onStartBot,
  onStopBot,
}: ControlPanelProps) {
  const isExecuting = botStatus.status === 'executing'
  const canStartBot = !isExecuting && !botLoading && hasCompany
  const canStartPoller = !pollerRunning && !pollerLoading && hasCompany

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
              onClick={onStartBot}
              disabled={!canStartBot}
            >
              {botLoading ? 'Iniciando...' : 'Iniciar Bot'}
            </button>
            <button
              className="btn btn--stop"
              onClick={onStopBot}
              disabled={!isExecuting || botLoading}
            >
              Detener Bot
            </button>
          </div>
          <span className="control-prompt__hint">
            {!hasCompany
              ? 'Debes registrar al menos una empresa antes de iniciar el bot.'
              : 'Para iniciar el bot o el poller, primero ingresa el prompt de imagen en la pestana inferior de terminales.'}
          </span>
        </div>
        <div className="control-section">
          <span className="control-label">Poller</span>
          <div className="control-buttons">
            <button
              className="btn btn--start"
              onClick={onStartPoller}
              disabled={!canStartPoller}
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
          {!imagePrompt.trim() && (
            <span className="control-prompt__hint">
              Para iniciar el poller, primero ingresa el prompt de imagen.
            </span>
          )}
        </div>
      </div>
    </GlassCard>
  )
}
