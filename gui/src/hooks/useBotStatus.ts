import { useState, useEffect } from 'react'
import type { BotStatus } from '../lib/types'
import { getBotStatus } from '../lib/commands'

export function useBotStatus(intervalMs = 2000) {
  const [status, setStatus] = useState<BotStatus>({
    status: 'offline',
    action: null,
    started_at: null,
    host: null,
    pid: null,
  })

  useEffect(() => {
    let mounted = true

    const poll = async () => {
      try {
        const s = await getBotStatus()
        if (mounted) setStatus(s)
      } catch {
        if (mounted) setStatus(prev => ({ ...prev, status: 'offline' }))
      }
    }

    poll()
    const id = setInterval(poll, intervalMs)
    return () => { mounted = false; clearInterval(id) }
  }, [intervalMs])

  return status
}
