import { useState, useEffect } from 'react'
import './App.css'
import { BrochurePage } from '../pages/BrochurePage'
import { ChatBotPage } from '../pages/ChatBotPage'
import { CompanyProfilesPage } from '../pages/CompanyProfilesPage'
import { Header } from '../components/Header'
import { useBranding } from '../features/home/useBranding'
import { MarketingCampaignModal } from '../features/marketing/MarketingCampaignModal'
import { useBotStatus } from '../hooks/useBotStatus'

type AppPage = 'assistant' | 'companies' | 'brochure'

export default function App() {
  const [page, setPage] = useState<AppPage>('assistant')
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [visiblePage, setVisiblePage] = useState<AppPage>('assistant')
  const [marketingOpen, setMarketingOpen] = useState(false)
  const { brandName, brandLogoUrl, refreshBrand } = useBranding()
  const botStatus = useBotStatus()

  function handleTabChange(newPage: AppPage) {
    if (newPage === page) return
    setShowSkeleton(true)
    setPage(newPage)
  }

  useEffect(() => {
    if (!showSkeleton) return
    const timer = setTimeout(() => {
      setVisiblePage(page)
      setShowSkeleton(false)
    }, 350)
    return () => clearTimeout(timer)
  }, [showSkeleton, page])

  // Sync on first render
  useEffect(() => { setVisiblePage(page) }, [])

  return (
    <div className="app">
      <Header
        status={botStatus}
        brandName={brandName}
        brandLogoUrl={brandLogoUrl}
      />
      <nav className="app-tabs">
        <button className={`app-tab ${page === 'assistant' ? 'app-tab--active' : ''}`} onClick={() => handleTabChange('assistant')}>
          Asistente
        </button>
        <button className={`app-tab ${page === 'companies' ? 'app-tab--active' : ''}`} onClick={() => handleTabChange('companies')}>
          Empresas
        </button>
      </nav>

      {page === 'assistant' && <ChatBotPage />}
      {page === 'companies' && <CompanyProfilesPage onCompaniesChanged={() => void refreshBrand()} />}
      {page === 'brochure' && <BrochurePage onClose={() => setPage('assistant')} />}

      <MarketingCampaignModal open={marketingOpen} onClose={() => setMarketingOpen(false)} />
    </div>
  )
}
