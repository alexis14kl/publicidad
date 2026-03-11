import { GlassCard } from './GlassCard'
import type { LastJob } from '../lib/types'

interface LastJobCardProps {
  job: LastJob | null
}

function formatTimestamp(ts: number): string {
  if (!ts) return '--'
  const d = new Date(ts * 1000)
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function getStatusClass(status: string): string {
  if (status === 'success') return 'badge--success'
  if (status === 'error' || status === 'failed') return 'badge--error'
  return 'badge--warn'
}

export function LastJobCard({ job }: LastJobCardProps) {
  return (
    <GlassCard className="last-job-card">
      <div className="card-header">
        <span className="card-icon">&#128203;</span>
        <span className="card-title">Ultimo Job</span>
      </div>
      {job ? (
        <div className="job-grid">
          <div className="job-item">
            <span className="job-label">ID</span>
            <span className="job-value job-value--mono">{job.last_job_id}</span>
          </div>
          <div className="job-item">
            <span className="job-label">Accion</span>
            <span className="job-value">{job.last_action}</span>
          </div>
          <div className="job-item">
            <span className="job-label">Estado</span>
            <span className={`job-badge ${getStatusClass(job.last_status)}`}>
              {job.last_status}
            </span>
          </div>
          <div className="job-item">
            <span className="job-label">Modo</span>
            <span className="job-value">{job.queue_mode}</span>
          </div>
          <div className="job-item">
            <span className="job-label">Fecha</span>
            <span className="job-value">{formatTimestamp(job.updated_at)}</span>
          </div>
        </div>
      ) : (
        <p className="no-data">Sin datos de jobs</p>
      )}
    </GlassCard>
  )
}
