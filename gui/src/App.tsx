import { useState } from 'react'
import './App.css'
import { CompanyProfilesPage } from './components/CompanyProfilesPage'
import { Header } from './components/Header'
import { SettingsPage } from './components/SettingsPage'
import { useBranding } from './features/home/useBranding'
import { MarketingCampaignModal } from './features/marketing/MarketingCampaignModal'
import { useBotStatus } from './hooks/useBotStatus'
import { HomePage } from './pages/HomePage'

type AppPage = 'home' | 'companies' | 'settings'

export default function App() {
  const [page, setPage] = useState<AppPage>('home')
  const [marketingOpen, setMarketingOpen] = useState(false)
  const { brandName, brandLogoUrl, refreshBrand } = useBranding()
  const botStatus = useBotStatus()

  return (
    <div className="app">
      <Header
        status={botStatus}
        brandName={brandName}
        brandLogoUrl={brandLogoUrl}
        onOpenSettings={() => setPage('settings')}
      />
      <nav className="app-tabs">
        <button className={`app-tab ${page === 'home' ? 'app-tab--active' : ''}`} onClick={() => setPage('home')}>
          Panel
        </button>
        <button className={`app-tab ${page === 'companies' ? 'app-tab--active' : ''}`} onClick={() => setPage('companies')}>
          Empresas
        </button>
        <button className={`app-tab ${page === 'settings' ? 'app-tab--active' : ''}`} onClick={() => setPage('settings')}>
          Configuraciones
        </button>
      </nav>

      {page === 'home' && <HomePage botStatus={botStatus} onOpenMarketing={() => setMarketingOpen(true)} />}
      {page === 'companies' && <CompanyProfilesPage onCompaniesChanged={() => void refreshBrand()} />}
      {page === 'settings' && <SettingsPage brandName={brandName} brandLogoUrl={brandLogoUrl} />}

      <MarketingCampaignModal open={marketingOpen} onClose={() => setMarketingOpen(false)} />
    </div>
  )
}
