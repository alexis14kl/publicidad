import type { BotStatus } from '../api/types'
import logoSvg from '../assets/logo.svg'

interface HeaderProps {
  status: BotStatus
  brandName?: string
  brandLogoUrl?: string | null
  onOpenSettings?: () => void
}

const STATUS_LABELS: Record<string, string> = {
  online: 'En linea',
  offline: 'Desconectado',
  executing: 'Ejecutando',
}

export function Header({ status, brandName, brandLogoUrl, onOpenSettings }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <img src={brandLogoUrl || logoSvg} alt={brandName || 'NoyeCode'} className="header-logo" />
        <div>
          <h1 className="header-title">Bot Publicitario</h1>
          <span className="header-subtitle">{brandName || 'NoyeCode'}</span>
        </div>
      </div>
      <div className="header-right">
        <div className="header-status">
          <span className={`status-dot status-dot--${status.status}`} />
          <span className="status-label">{STATUS_LABELS[status.status]}</span>
        </div>
        {onOpenSettings && (
          <button className="btn btn--ghost btn--icon" onClick={onOpenSettings} title="Configuraciones">
            &#9881;
          </button>
        )}
      </div>
    </header>
  )
}
