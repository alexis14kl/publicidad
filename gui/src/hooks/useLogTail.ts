import { useState, useEffect, useCallback, useRef } from 'react'
import { readLogLines, onLogNewLines } from '../lib/commands'

const MAX_LINES = 500

export function useLogTail() {
  const [lines, setLines] = useState<string[]>([])
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    // Load initial lines
    readLogLines(200).then((initial) => {
      if (mountedRef.current) setLines(initial)
    }).catch(() => {})

    // Subscribe to new lines
    const unsubscribe = onLogNewLines((newLines) => {
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
