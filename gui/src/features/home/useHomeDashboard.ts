import { useEffect, useState } from 'react'
import { useBotLogTail } from '../../hooks/useBotLogTail'
import { useLastJob } from '../../hooks/useLastJob'
import { useLogTail } from '../../hooks/useLogTail'
import { usePollerProcess } from '../../hooks/usePollerProcess'
import { generateDefaultPrompt, listCompanyRecords, startBot, stopBot } from '../../shared/api/commands'
import { NOYECODE_SERVICES, type BotStatus, type CompanyRecord, type PromptHistoryEntry } from '../../shared/api/types'

const STORAGE_KEYS = {
  imageFormat: 'imageFormat',
  imageService: 'imageService',
  imagePromptHistory: 'imagePromptHistory',
  lastUsedService: 'lastUsedService',
  selectedCompany: 'selectedCompany',
} as const

export function useHomeDashboard(botStatus: BotStatus) {
  const [botLoading, setBotLoading] = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')
  const [imagePromptHistory, setImagePromptHistory] = useState<PromptHistoryEntry[]>([])
  const [imageFormat, setImageFormat] = useState(() =>
    window.localStorage.getItem(STORAGE_KEYS.imageFormat) || 'fb-vertical'
  )
  const [imageService, setImageService] = useState(() =>
    window.localStorage.getItem(STORAGE_KEYS.imageService) || NOYECODE_SERVICES[0].value
  )
  const [lastUsedService, setLastUsedService] = useState(() =>
    window.localStorage.getItem(STORAGE_KEYS.lastUsedService) || ''
  )
  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [selectedCompany, setSelectedCompany] = useState('')
  const [publishPlatforms, setPublishPlatforms] = useState<Record<string, boolean>>({})

  const poller = usePollerProcess()
  const { lines: workerLines, clearLines: clearWorkerLines } = useLogTail()
  const { lines: botLines, clearLines: clearBotLines } = useBotLogTail()
  const lastJob = useLastJob()
  const isExecuting = botStatus.status === 'executing'

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.imagePromptHistory)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const history: PromptHistoryEntry[] = parsed
        .map((item: unknown) => {
          if (typeof item === 'string') {
            return { text: item.trim(), createdAt: null }
          }
          if (typeof item === 'object' && item !== null && 'text' in item) {
            const entry = item as { text: string; createdAt?: string | null }
            return { text: String(entry.text || '').trim(), createdAt: entry.createdAt ?? null }
          }
          return null
        })
        .filter((entry): entry is PromptHistoryEntry => entry !== null && entry.text !== '')
        .slice(0, 10)
      setImagePromptHistory(history)
    } catch {
      // Ignore invalid local storage state.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    generateDefaultPrompt()
      .then((result) => {
        if (!cancelled && result.success && result.prompt) {
          setImagePrompt((current) => current.trim() ? current : result.prompt)
        }
      })
      .catch(() => { /* ignore */ })
    listCompanyRecords()
      .then((records) => {
        if (!cancelled) {
          setCompanies(records)
        }
      })
      .catch(() => { /* ignore */ })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const activeCompanies = companies.filter((company) => company.activo)
    if (activeCompanies.length === 0) {
      if (selectedCompany) {
        setSelectedCompany('')
      }
      return
    }
    if (activeCompanies.some((company) => company.nombre === selectedCompany)) {
      return
    }
    const saved = window.localStorage.getItem(STORAGE_KEYS.selectedCompany) || ''
    const fallback = activeCompanies.find((company) => company.nombre === saved) || activeCompanies[0]
    setSelectedCompany(fallback.nombre)
    const nextPlatforms: Record<string, boolean> = {}
    fallback.platforms.forEach((platform) => {
      nextPlatforms[platform.platform] = true
    })
    setPublishPlatforms(nextPlatforms)
    try {
      window.localStorage.setItem(STORAGE_KEYS.selectedCompany, fallback.nombre)
    } catch {
      // Ignore storage failures.
    }
  }, [companies, selectedCompany])

  const rememberPrompt = (prompt: string) => {
    const normalized = prompt.trim()
    if (!normalized) return
    const entry: PromptHistoryEntry = { text: normalized, createdAt: new Date().toISOString() }
    setImagePromptHistory((current) => {
      const next = [entry, ...current.filter((item) => item.text !== normalized)].slice(0, 10)
      try {
        window.localStorage.setItem(STORAGE_KEYS.imagePromptHistory, JSON.stringify(next))
      } catch {
        // Ignore storage failures.
      }
      return next
    })
  }

  const handleChangeFormat = (value: string) => {
    setImageFormat(value)
    try {
      window.localStorage.setItem(STORAGE_KEYS.imageFormat, value)
    } catch {
      // Ignore storage failures.
    }
  }

  const handleChangeService = (value: string) => {
    setImageService(value)
    try {
      window.localStorage.setItem(STORAGE_KEYS.imageService, value)
    } catch {
      // Ignore storage failures.
    }
  }

  const handleChangeCompany = (value: string) => {
    setSelectedCompany(value)
    try {
      window.localStorage.setItem(STORAGE_KEYS.selectedCompany, value)
    } catch {
      // Ignore storage failures.
    }
    const company = companies.find((item) => item.nombre === value)
    if (company) {
      const nextPlatforms: Record<string, boolean> = {}
      company.platforms.forEach((platform) => {
        nextPlatforms[platform.platform] = true
      })
      setPublishPlatforms(nextPlatforms)
    }
  }

  const handleTogglePlatform = (platform: string) => {
    setPublishPlatforms((prev) => ({ ...prev, [platform]: !prev[platform] }))
  }

  const startWithContext = () => {
    const prompt = imagePrompt.trim()
    if (!prompt) return null
    rememberPrompt(prompt)
    setLastUsedService(imageService)
    try {
      window.localStorage.setItem(STORAGE_KEYS.lastUsedService, imageService)
    } catch {
      // Ignore storage failures.
    }
    return prompt
  }

  const handleStartPoller = async () => {
    if (poller.running || poller.loading) return
    const prompt = startWithContext()
    if (!prompt) return
    await poller.start({ imagePrompt: prompt, imageFormat, imageService, companyName: selectedCompany })
  }

  const handleStartBot = async () => {
    if (isExecuting || botLoading) return
    const prompt = imagePrompt.trim()
    if (!prompt) return
    setBotLoading(true)
    try {
      startWithContext()
      await startBot({ imagePrompt: prompt, imageFormat, imageService, companyName: selectedCompany })
    } finally {
      setBotLoading(false)
    }
  }

  const handleStopBot = async () => {
    if (botLoading) return
    setBotLoading(true)
    try {
      await stopBot()
    } finally {
      setBotLoading(false)
    }
  }

  return {
    botLines,
    botLoading,
    botStatus,
    clearBotLines,
    clearWorkerLines,
    companies: companies.filter((company) => company.activo),
    handleChangeCompany,
    handleChangeFormat,
    handleChangeService,
    handleStartBot,
    handleStartPoller,
    handleStopBot,
    handleTogglePlatform,
    hasCompany: companies.some((company) => company.activo),
    imageFormat,
    imagePrompt,
    imagePromptHistory,
    imageService,
    isExecuting,
    lastJob,
    lastUsedService,
    poller,
    promptDisabled: isExecuting || botLoading,
    publishPlatforms,
    selectedCompany,
    setImagePrompt,
    workerLines,
  }
}
