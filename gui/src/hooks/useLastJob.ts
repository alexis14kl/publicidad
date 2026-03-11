import { useState, useEffect } from 'react'
import type { LastJob } from '../lib/types'
import { getLastJob } from '../lib/commands'

export function useLastJob(intervalMs = 5000) {
  const [job, setJob] = useState<LastJob | null>(null)

  useEffect(() => {
    let mounted = true

    const poll = async () => {
      try {
        const j = await getLastJob()
        if (mounted) setJob(j)
      } catch { /* ignore */ }
    }

    poll()
    const id = setInterval(poll, intervalMs)
    return () => { mounted = false; clearInterval(id) }
  }, [intervalMs])

  return job
}
