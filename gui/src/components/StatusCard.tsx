import { GlassCard } from './GlassCard'
import type { BotStatus } from '../api/types'

interface StatusCardProps {
  status: BotStatus
  activeJobCount?: number
  queuedJobCount?: number
}

function formatElapsed(startedAt: number | null): string {
  if (!startedAt) return '--'
  const elapsed = Math.floor(Date.now() / 1000 - startedAt)
  if (elapsed < 0) return '--'
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  return `${mins}m ${secs}s`
}

export function StatusCard({ status, activeJobCount = 0, queuedJobCount = 0 }: StatusCardProps) {
  const isExecuting = status.status === 'executing'
  const hasJobs = activeJobCount > 0 || queuedJobCount > 0

  const statusLabel = hasJobs
    ? `${activeJobCount} activo(s)${queuedJobCount > 0 ? ` + ${queuedJobCount} en cola` : ''}`
    : status.status === 'online' ? 'Idle'
    : status.status === 'executing' ? 'Ejecutando'
    : 'Offline'

  return (
    <GlassCard className="status-card">
      <div className="card-header">
        <span className="card-icon">&#9881;</span>
        <span className="card-title">Estado del Bot</span>
      </div>
      <div className="status-grid">
        <div className="status-item">
          <span className="status-item-label">Estado</span>
          <span className={`status-badge status-badge--${hasJobs ? 'executing' : status.status}`}>
            {statusLabel}
          </span>
        </div>
        {isExecuting && !hasJobs && (
          <>
            <div className="status-item">
              <span className="status-item-label">Accion</span>
              <span className="status-item-value">{status.action || '--'}</span>
            </div>
            <div className="status-item">
              <span className="status-item-label">Tiempo</span>
              <span className="status-item-value">{formatElapsed(status.started_at)}</span>
            </div>
            <div className="status-item">
              <span className="status-item-label">PID</span>
              <span className="status-item-value">{status.pid || '--'}</span>
            </div>
          </>
        )}
      </div>
    </GlassCard>
  )
}
