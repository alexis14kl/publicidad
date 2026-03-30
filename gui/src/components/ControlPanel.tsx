import { GlassCard } from './GlassCard'
import type { BotStatus } from '../api/types'

interface ControlPanelProps {
  botStatus: BotStatus
  botLoading: boolean
  imagePrompt: string
  hasCompany: boolean
  pollerRunning: boolean
  pollerLoading: boolean
  activeJobCount?: number
  queuedJobCount?: number
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
  activeJobCount = 0,
  queuedJobCount = 0,
  onStartPoller,
  onStopPoller,
  onStartBot,
  onStopBot,
}: ControlPanelProps) {
  const hasPrompt = !!imagePrompt.trim()
  // UI is always interactive — user can always enqueue new jobs
  const canStartBot = !botLoading && hasCompany && hasPrompt
  const canStartPoller = !pollerRunning && !pollerLoading && hasCompany && hasPrompt
  const hasActiveJobs = activeJobCount > 0

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
              {botLoading ? 'Encolando...' : hasActiveJobs ? `Encolar (+${activeJobCount})` : 'Encolar Job'}
            </button>
            <button
              className="btn btn--stop"
              onClick={onStopBot}
              disabled={!hasActiveJobs || botLoading}
            >
              Detener{hasActiveJobs ? ` (${activeJobCount})` : ''}
            </button>
          </div>
          <span className="control-prompt__hint">
            {!hasCompany
              ? 'Debes registrar al menos una empresa antes de iniciar el bot.'
              : !hasPrompt
              ? 'Escribe un prompt en el tab activo para habilitar el bot.'
              : queuedJobCount > 0
              ? `${queuedJobCount} job(s) en cola esperando`
              : ''}
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
