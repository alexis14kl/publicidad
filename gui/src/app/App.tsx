import { useState, useEffect } from 'react'
import './App.css'
import { BrochurePage } from '../pages/BrochurePage'
import { ChatBotPage } from '../pages/ChatBotPage'
import { CompanyProfilesPage } from '../pages/CompanyProfilesPage'
import { Header } from '../components/Header'
import { SettingsPage } from '../pages/SettingsPage'
import { useBranding } from '../features/home/useBranding'
import { MarketingCampaignModal } from '../features/marketing/MarketingCampaignModal'
import { useBotStatus } from '../hooks/useBotStatus'

type AppPage = 'assistant' | 'companies' | 'settings' | 'brochure'

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
        onOpenSettings={() => handleTabChange('settings')}
      />
      <nav className="app-tabs">
        <button className={`app-tab ${page === 'assistant' ? 'app-tab--active' : ''}`} onClick={() => handleTabChange('assistant')}>
          Asistente
        </button>
        <button className={`app-tab ${page === 'companies' ? 'app-tab--active' : ''}`} onClick={() => handleTabChange('companies')}>
          Empresas
        </button>
        <button className={`app-tab ${page === 'settings' ? 'app-tab--active' : ''}`} onClick={() => handleTabChange('settings')}>
          Configuraciones
        </button>
      </nav>

      {showSkeleton ? (
        <div className="tab-skeleton">
          <div className="tab-skeleton__bar tab-skeleton__bar--lg" />
          <div className="tab-skeleton__bar tab-skeleton__bar--md" />
          <div className="tab-skeleton__bar tab-skeleton__bar--sm" />
          <div className="tab-skeleton__block" />
          <div className="tab-skeleton__bar tab-skeleton__bar--md" />
          <div className="tab-skeleton__bar tab-skeleton__bar--lg" />
        </div>
      ) : (
        <div className="tab-content-enter">
          {visiblePage === 'assistant' && <ChatBotPage />}
          {visiblePage === 'companies' && <CompanyProfilesPage onCompaniesChanged={() => void refreshBrand()} />}
          {visiblePage === 'settings' && <SettingsPage brandName={brandName} brandLogoUrl={brandLogoUrl} />}
          {visiblePage === 'brochure' && <BrochurePage onClose={() => handleTabChange('assistant')} />}
        </div>
      )}

      <MarketingCampaignModal open={marketingOpen} onClose={() => setMarketingOpen(false)} />
    </div>
  )
}
