import { useState, useEffect, useCallback } from 'react'
import { isPollerRunning, startPoller, stopPoller } from '../lib/commands'
import type { StartPollerPayload } from '../lib/types'

export function usePollerProcess(intervalMs = 3000) {
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let mounted = true

    const poll = async () => {
      try {
        const r = await isPollerRunning()
        if (mounted) setRunning(r)
      } catch { /* ignore */ }
    }

    poll()
    const id = setInterval(poll, intervalMs)
    return () => { mounted = false; clearInterval(id) }
  }, [intervalMs])

  const start = useCallback(async (payload?: StartPollerPayload) => {
    setLoading(true)
    try {
      const result = await startPoller(payload)
      if (result.success) setRunning(true)
      return result
    } finally {
      setLoading(false)
    }
  }, [])

  const stop = useCallback(async () => {
    setLoading(true)
    try {
      const result = await stopPoller()
      if (result.success) setRunning(false)
      return result
    } finally {
      setLoading(false)
    }
  }, [])

  return { running, loading, start, stop }
}
