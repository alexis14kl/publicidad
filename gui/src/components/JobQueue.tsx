import { useState } from 'react'
import { GlassCard } from './GlassCard'
import type { JobDetail } from '../api/types'
import { getJobLogLines } from '../api/commands'

interface JobQueueProps {
  activeJobs: JobDetail[]
  queuedJobs: JobDetail[]
  recentJobs: JobDetail[]
  onCancel: (jobId: string) => void
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'En cola',
  claimed: 'Reclamado',
  running: 'Ejecutando',
  success: 'Completado',
  error: 'Error',
  cancelled: 'Cancelado',
}

const WORKER_LABELS: Record<string, string> = {
  cdp: 'CDP',
  api: 'API',
  publish: 'Publicar',
  video: 'Video',
  brochure: 'Brochure',
}

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return '--'
  const start = new Date(startedAt).getTime()
  const elapsed = Math.floor((Date.now() - start) / 1000)
  if (elapsed < 0) return '--'
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  return `${mins}m ${secs}s`
}

function JobCard({ job, onCancel }: { job: JobDetail; onCancel: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const isActive = job.status === 'running' || job.status === 'claimed' || job.status === 'queued'

  const handleToggleLogs = async () => {
    if (!expanded && job.log_file) {
      try {
        const lines = await getJobLogLines(job.job_id, 50)
        setLogLines(lines)
      } catch { /* ignore */ }
    }
    setExpanded(!expanded)
  }

  return (
    <div className={`job-card job-card--${job.status}`}>
      <div className="job-card-header" onClick={handleToggleLogs} style={{ cursor: 'pointer' }}>
        <div className="job-card-info">
          <span className={`status-badge status-badge--${job.status === 'running' ? 'executing' : job.status}`}>
            {STATUS_LABELS[job.status] || job.status}
          </span>
          <span className="job-card-action">{job.action}</span>
          <span className="job-card-type">{WORKER_LABELS[job.worker_type] || job.worker_type}</span>
          {job.company_name && <span className="job-card-company">{job.company_name}</span>}
        </div>
        <div className="job-card-meta">
          {job.status === 'running' && (
            <span className="job-card-elapsed">{formatElapsed(job.started_at)}</span>
          )}
          {isActive && (
            <button
              className="job-card-cancel"
              onClick={(e) => { e.stopPropagation(); onCancel(job.job_id) }}
              title="Cancelar job"
            >
              &#10005;
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="job-card-logs">
          {job.error_text && <div className="job-card-error">{job.error_text}</div>}
          {logLines.length > 0 ? (
            <pre className="job-card-log-content">
              {logLines.join('\n')}
            </pre>
          ) : (
            <span className="job-card-no-logs">Sin logs disponibles</span>
          )}
        </div>
      )}
    </div>
  )
}

export function JobQueue({ activeJobs, queuedJobs, recentJobs, onCancel }: JobQueueProps) {
  const hasJobs = activeJobs.length > 0 || queuedJobs.length > 0 || recentJobs.length > 0

  return (
    <GlassCard className="job-queue">
      <div className="card-header">
        <span className="card-icon">&#9776;</span>
        <span className="card-title">Cola de Jobs</span>
        {(activeJobs.length > 0 || queuedJobs.length > 0) && (
          <span className="job-queue-badge">
            {activeJobs.length} activos{queuedJobs.length > 0 ? ` / ${queuedJobs.length} en cola` : ''}
          </span>
        )}
      </div>
      {!hasJobs ? (
        <div className="job-queue-empty">Sin jobs recientes</div>
      ) : (
        <div className="job-queue-list">
          {activeJobs.map(j => <JobCard key={j.job_id} job={j} onCancel={onCancel} />)}
          {queuedJobs.map(j => <JobCard key={j.job_id} job={j} onCancel={onCancel} />)}
          {recentJobs.slice(0, 5).map(j => <JobCard key={j.job_id} job={j} onCancel={onCancel} />)}
        </div>
      )}
    </GlassCard>
  )
}
