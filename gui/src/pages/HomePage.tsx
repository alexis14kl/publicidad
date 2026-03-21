import { useEffect, useState } from 'react'
import { BotTabs, type BotTabId } from '../components/BotTabs'
import { ControlPanel } from '../components/ControlPanel'
import { DualLogViewer } from '../components/DualLogViewer'
import { ImageTabContent } from '../components/ImageTabContent'
import { LastJobCard } from '../components/LastJobCard'
import { PreflightBanner } from '../components/PreflightBanner'
import { SharedCompanyBar } from '../components/SharedCompanyBar'
import { StatusCard } from '../components/StatusCard'
import { VideoTabContent } from '../components/VideoTabContent'
import { useHomeDashboard } from '../features/home/useHomeDashboard'
import { buildEmptyVideoScenes, type VideoSceneHistoryEntry } from '../features/home/videoScenes'
import { analyzeVideoScenes, startBot } from '../shared/api/commands'
import type { AnalyzeVideoScenesResult, BotStatus } from '../shared/api/types'

const STORAGE_KEY_TAB = 'botActiveTab'
const STORAGE_KEY_VIDEO_SCENE_HISTORY = 'videoSceneHistory'
const STORAGE_KEY_VIDEO_SCENE_PROMPT_MODE = 'videoScenePromptMode'

export function HomePage({
  botStatus,
  onOpenMarketing,
  onOpenBrochure,
}: {
  botStatus: BotStatus
  onOpenMarketing: () => void
  onOpenBrochure: () => void
}) {
  const dashboard = useHomeDashboard(botStatus)
  const [activeTab, setActiveTab] = useState<BotTabId>(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY_TAB)
    return saved === 'video' ? 'video' : 'image'
  })

  // Video state (lifted from VideoTabContent for ControlPanel access)
  const [videoPrompt, setVideoPrompt] = useState('')
  const [videoTitle, setVideoTitle] = useState('')
  const [videoCaption, setVideoCaption] = useState('')
  const [videoScenes, setVideoScenes] = useState(() => buildEmptyVideoScenes())
  const [videoSceneHistory, setVideoSceneHistory] = useState<VideoSceneHistoryEntry[]>([])
  const [videoSceneSummary, setVideoSceneSummary] = useState('Escribe un prompt y el agente armara tres escenas antes de enviar el video al bot.')
  const [videoCompiledPrompt, setVideoCompiledPrompt] = useState('')
  const [videoSceneAnalysisLoading, setVideoSceneAnalysisLoading] = useState(false)
  const [useScenesForVideoBot, setUseScenesForVideoBot] = useState(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY_VIDEO_SCENE_PROMPT_MODE)
    return saved !== 'prompt'
  })

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY_VIDEO_SCENE_HISTORY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      setVideoSceneHistory(
        parsed.filter((item: unknown): item is VideoSceneHistoryEntry => {
          if (!item || typeof item !== 'object') return false
          const candidate = item as VideoSceneHistoryEntry
          return (
            typeof candidate.prompt === 'string' &&
            typeof candidate.compiledPrompt === 'string' &&
            Array.isArray(candidate.scenes)
          )
        }).slice(0, 10)
      )
    } catch {
      // Ignore invalid local storage state.
    }
  }, [])

  useEffect(() => {
    const prompt = videoPrompt.trim()
    if (!prompt) {
      setVideoScenes(buildEmptyVideoScenes())
      setVideoSceneSummary('Escribe un prompt y el agente armara tres escenas antes de enviar el video al bot.')
      setVideoCompiledPrompt('')
      setVideoSceneAnalysisLoading(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setVideoSceneAnalysisLoading(true)
      analyzeVideoScenes({ prePrompt: prompt })
        .then((result: AnalyzeVideoScenesResult) => {
          if (cancelled) return
          const nextScenes = Array.isArray(result.scenes) && result.scenes.length > 0
            ? result.scenes
            : buildEmptyVideoScenes()
          setVideoScenes(nextScenes)
          setVideoSceneSummary(result.summary || 'El agente preparo las escenas del video.')
          setVideoCompiledPrompt(result.compiledPrompt || '')
          setVideoSceneHistory((current) => {
            const entry: VideoSceneHistoryEntry = {
              prompt,
              scenes: nextScenes,
              compiledPrompt: result.compiledPrompt || '',
              createdAt: new Date().toISOString(),
            }
            const next = [entry, ...current.filter((item) => item.prompt !== prompt)].slice(0, 10)
            try {
              window.localStorage.setItem(STORAGE_KEY_VIDEO_SCENE_HISTORY, JSON.stringify(next))
            } catch {
              // Ignore storage failures.
            }
            return next
          })
        })
        .catch(() => {
          if (cancelled) return
          setVideoScenes(buildEmptyVideoScenes())
          setVideoSceneSummary('No pude generar las escenas con el agente en este momento.')
          setVideoCompiledPrompt('')
        })
        .finally(() => {
          if (!cancelled) {
            setVideoSceneAnalysisLoading(false)
          }
        })
    }, 550)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [videoPrompt])

  const handleChangeTab = (tab: BotTabId) => {
    setActiveTab(tab)
    try { window.localStorage.setItem(STORAGE_KEY_TAB, tab) } catch { /* ignore */ }
  }

  const getSceneOnePromptForBot = () => {
    const sceneOne = videoScenes.find((scene) => scene.id === 'scene-1') || videoScenes[0]
    return String(sceneOne?.prompt || '').trim()
  }

  // Contextual start bot: image or video depending on active tab
  const handleStartBot = async () => {
    if (activeTab === 'video') {
      const prompt = videoPrompt.trim()
      if (!prompt) return
      const sceneOnePrompt = getSceneOnePromptForBot()
      if (useScenesForVideoBot && (videoSceneAnalysisLoading || !sceneOnePrompt)) {
        return
      }
      const promptForBot = useScenesForVideoBot && sceneOnePrompt
        ? sceneOnePrompt
        : prompt
      const activePlatforms = Object.entries(dashboard.publishPlatforms)
        .filter(([, checked]) => checked)
        .map(([name]) => name)
      await startBot({
        profileName: 'Flow Veo 3',
        imagePrompt: promptForBot,
        companyName: dashboard.selectedCompany,
        contentType: 'reel',
        reelTitle: videoTitle.trim() || 'Reel publicitario',
        reelCaption: videoCaption.trim(),
        publishPlatforms: activePlatforms,
      })
    } else {
      await dashboard.handleStartBot()
    }
  }

  // Prompt for ControlPanel hint: depends on active tab
  const activePrompt = activeTab === 'video' ? videoPrompt : dashboard.imagePrompt

  return (
    <div className="home-page">
      <PreflightBanner />

      <div className="top-actions">
        <button className="btn btn--marketing" onClick={onOpenMarketing}>
          Abrir Agente Marketing
        </button>
        <button className="btn btn--brochure" onClick={onOpenBrochure}>
          Generar Brochure
        </button>
      </div>

      <main className="main-grid">
        <StatusCard status={dashboard.botStatus} />
        <ControlPanel
          botStatus={dashboard.botStatus}
          botLoading={dashboard.botLoading}
          imagePrompt={activePrompt}
          hasCompany={dashboard.hasCompany}
          pollerRunning={dashboard.poller.running}
          pollerLoading={dashboard.poller.loading}
          onStartPoller={dashboard.handleStartPoller}
          onStopPoller={dashboard.poller.stop}
          onStartBot={handleStartBot}
          onStopBot={dashboard.handleStopBot}
        />
        <LastJobCard job={dashboard.lastJob} />
      </main>

      <SharedCompanyBar
        companies={dashboard.companies}
        selectedCompany={dashboard.selectedCompany}
        onChangeCompany={dashboard.handleChangeCompany}
        publishPlatforms={dashboard.publishPlatforms}
        onTogglePlatform={dashboard.handleTogglePlatform}
        disabled={dashboard.promptDisabled}
      />

      <BotTabs activeTab={activeTab} onChangeTab={handleChangeTab}>
        {{
          image: (
            <ImageTabContent
              imagePrompt={dashboard.imagePrompt}
              onChangePrompt={dashboard.setImagePrompt}
              imageFormat={dashboard.imageFormat}
              onChangeFormat={dashboard.handleChangeFormat}
              imageService={dashboard.imageService}
              onChangeService={dashboard.handleChangeService}
              lastUsedService={dashboard.lastUsedService}
              promptHistory={dashboard.imagePromptHistory}
              serviceSuggestions={dashboard.serviceSuggestions}
              disabled={dashboard.promptDisabled}
            />
          ),
          video: (
            <VideoTabContent
              companies={dashboard.companies}
              selectedCompany={dashboard.selectedCompany}
              disabled={dashboard.promptDisabled}
              videoPrompt={videoPrompt}
              onChangeVideoPrompt={setVideoPrompt}
              videoTitle={videoTitle}
              onChangeVideoTitle={setVideoTitle}
              videoCaption={videoCaption}
              onChangeVideoCaption={setVideoCaption}
              videoScenes={videoScenes}
              videoSceneSummary={videoSceneSummary}
              videoSceneAnalysisLoading={videoSceneAnalysisLoading}
              videoSceneHistory={videoSceneHistory}
              useScenesForVideoBot={useScenesForVideoBot}
              onToggleUseScenesForVideoBot={(value) => {
                setUseScenesForVideoBot(value)
                try {
                  window.localStorage.setItem(STORAGE_KEY_VIDEO_SCENE_PROMPT_MODE, value ? 'scenes' : 'prompt')
                } catch {
                  // Ignore storage failures.
                }
              }}
              onUseSceneHistory={(entry) => {
                setVideoPrompt(entry.prompt)
                setVideoScenes(entry.scenes)
                setVideoCompiledPrompt(entry.compiledPrompt)
              }}
            />
          ),
        }}
      </BotTabs>

      <DualLogViewer
        workerLines={dashboard.workerLines}
        onClearWorker={dashboard.clearWorkerLines}
        botLines={dashboard.botLines}
        onClearBot={dashboard.clearBotLines}
      />
    </div>
  )
}
