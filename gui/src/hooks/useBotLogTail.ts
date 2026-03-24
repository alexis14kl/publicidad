import { useState, useEffect, useCallback, useRef } from 'react'
import { onBotLogLines } from '../api/commands'

const MAX_LINES = 500

export function useBotLogTail() {
  const [lines, setLines] = useState<string[]>([])
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    const unsubscribe = onBotLogLines((newLines) => {
      if (!mountedRef.current) return
      setLines(prev => {
        const combined = [...prev, ...newLines]
        return combined.length > MAX_LINES
          ? combined.slice(-MAX_LINES)
          : combined
      })
    })

    return () => {
      mountedRef.current = false
      unsubscribe()
    }
  }, [])

  const clearLines = useCallback(() => {
    setLines([])
  }, [])

  return { lines, clearLines }
}
