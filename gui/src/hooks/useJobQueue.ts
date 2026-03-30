import { useState, useEffect, useCallback } from 'react'
import type { JobDetail } from '../api/types'
import { listJobs, cancelJob as cancelJobCmd, onJobStatusChange } from '../api/commands'

export function useJobQueue(pollIntervalMs = 2000) {
  const [jobs, setJobs] = useState<JobDetail[]>([])

  const refresh = useCallback(async () => {
    try {
      const all = await listJobs({ limit: 30 })
      setJobs(all)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    let mounted = true

    const poll = async () => {
      if (!mounted) return
      await refresh()
    }

    const timer = setTimeout(poll, 300)
    const id = setInterval(poll, pollIntervalMs)

    // Listen for real-time job status changes
    const unsub = onJobStatusChange((updatedJob) => {
      if (!mounted) return
      setJobs(prev => {
        const idx = prev.findIndex(j => j.job_id === updatedJob.job_id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = updatedJob
          return next
        }
        return [updatedJob, ...prev]
      })
    })

    return () => {
      mounted = false
      clearTimeout(timer)
      clearInterval(id)
      unsub()
    }
  }, [pollIntervalMs, refresh])

  const cancel = useCallback(async (jobId: string) => {
    await cancelJobCmd(jobId)
    await refresh()
  }, [refresh])

  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'claimed')
  const queuedJobs = jobs.filter(j => j.status === 'queued')
  const recentJobs = jobs.filter(j => j.status === 'success' || j.status === 'error' || j.status === 'cancelled')

  return {
    jobs,
    activeJobs,
    queuedJobs,
    recentJobs,
    activeCount: activeJobs.length,
    queuedCount: queuedJobs.length,
    cancel,
    refresh,
  }
}
