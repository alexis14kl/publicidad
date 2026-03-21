import { useState } from 'react'
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
import { startBot } from '../shared/api/commands'
import type { BotStatus } from '../shared/api/types'

const STORAGE_KEY_TAB = 'botActiveTab'

export function HomePage({
  botStatus,
  onOpenMarketing,
}: {
  botStatus: BotStatus
  onOpenMarketing: () => void
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

  const handleChangeTab = (tab: BotTabId) => {
    setActiveTab(tab)
    try { window.localStorage.setItem(STORAGE_KEY_TAB, tab) } catch { /* ignore */ }
  }

  // Contextual start bot: image or video depending on active tab
  const handleStartBot = async () => {
    if (activeTab === 'video') {
      const prompt = videoPrompt.trim()
      if (!prompt) return
      const activePlatforms = Object.entries(dashboard.publishPlatforms)
        .filter(([, checked]) => checked)
        .map(([name]) => name)
      await startBot({
        profileName: 'Flow Veo 3',
        imagePrompt: prompt,
        companyName: dashboard.selectedCompany,
        contentType: 'reel',
        reelTitle: videoTitle.trim() || 'Reel publicitario',
        reelCaption: videoCaption.trim(),
        publishPlatforms: activePlatforms,
      } as any)
    } else {
      await dashboard.handleStartBot()
    }
  }

  // Prompt for ControlPanel hint: depends on active tab
  const activePrompt = activeTab === 'video' ? videoPrompt : dashboard.imagePrompt

  return (
    <>
      <PreflightBanner />

      <div className="top-actions">
        <button className="btn btn--marketing" onClick={onOpenMarketing}>
          Abrir Agente Marketing
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
    </>
  )
}
