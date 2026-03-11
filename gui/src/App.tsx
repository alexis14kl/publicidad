import './App.css'
import { Header } from './components/Header'
import { StatusCard } from './components/StatusCard'
import { ControlPanel } from './components/ControlPanel'
import { LastJobCard } from './components/LastJobCard'
import { DualLogViewer } from './components/DualLogViewer'
import { useBotStatus } from './hooks/useBotStatus'
import { usePollerProcess } from './hooks/usePollerProcess'
import { useLogTail } from './hooks/useLogTail'
import { useBotLogTail } from './hooks/useBotLogTail'
import { useLastJob } from './hooks/useLastJob'

export default function App() {
  const botStatus = useBotStatus()
  const poller = usePollerProcess()
  const { lines: workerLines, clearLines: clearWorkerLines } = useLogTail()
  const { lines: botLines, clearLines: clearBotLines } = useBotLogTail()
  const lastJob = useLastJob()

  return (
    <div className="app">
      <Header status={botStatus} />
      <main className="main-grid">
        <StatusCard status={botStatus} />
        <ControlPanel
          botStatus={botStatus}
          pollerRunning={poller.running}
          pollerLoading={poller.loading}
          onStartPoller={poller.start}
          onStopPoller={poller.stop}
        />
        <LastJobCard job={lastJob} />
      </main>
      <DualLogViewer
        workerLines={workerLines}
        onClearWorker={clearWorkerLines}
        botLines={botLines}
        onClearBot={clearBotLines}
      />
    </div>
  )
}
