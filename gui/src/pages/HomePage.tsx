import { ControlPanel } from '../components/ControlPanel'
import { DualLogViewer } from '../components/DualLogViewer'
import { LastJobCard } from '../components/LastJobCard'
import { PreflightBanner } from '../components/PreflightBanner'
import { StatusCard } from '../components/StatusCard'
import { useHomeDashboard } from '../features/home/useHomeDashboard'
import type { BotStatus } from '../shared/api/types'

export function HomePage({
  botStatus,
  onOpenMarketing,
}: {
  botStatus: BotStatus
  onOpenMarketing: () => void
}) {
  const dashboard = useHomeDashboard(botStatus)

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
          imagePrompt={dashboard.imagePrompt}
          hasCompany={dashboard.hasCompany}
          pollerRunning={dashboard.poller.running}
          pollerLoading={dashboard.poller.loading}
          onStartPoller={dashboard.handleStartPoller}
          onStopPoller={dashboard.poller.stop}
          onStartBot={dashboard.handleStartBot}
          onStopBot={dashboard.handleStopBot}
        />
        <LastJobCard job={dashboard.lastJob} />
      </main>
      <DualLogViewer
        workerLines={dashboard.workerLines}
        onClearWorker={dashboard.clearWorkerLines}
        botLines={dashboard.botLines}
        onClearBot={dashboard.clearBotLines}
        imagePrompt={dashboard.imagePrompt}
        onChangeImagePrompt={dashboard.setImagePrompt}
        imagePromptHistory={dashboard.imagePromptHistory}
        companies={dashboard.companies}
        selectedCompany={dashboard.selectedCompany}
        onChangeCompany={dashboard.handleChangeCompany}
        publishPlatforms={dashboard.publishPlatforms}
        onTogglePlatform={dashboard.handleTogglePlatform}
        imageService={dashboard.imageService}
        onChangeImageService={dashboard.handleChangeService}
        lastUsedService={dashboard.lastUsedService}
        imageFormat={dashboard.imageFormat}
        onChangeImageFormat={dashboard.handleChangeFormat}
        promptDisabled={dashboard.promptDisabled}
      />
    </>
  )
}
