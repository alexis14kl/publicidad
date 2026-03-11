import type { BotStatus } from '../lib/types'

interface HeaderProps {
  status: BotStatus
  onOpenSettings?: () => void
}

const STATUS_LABELS: Record<string, string> = {
  online: 'En linea',
  offline: 'Desconectado',
  executing: 'Ejecutando',
}

export function Header({ status, onOpenSettings }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="header-logo">NC</div>
        <div>
          <h1 className="header-title">Bot Publicitario</h1>
          <span className="header-subtitle">NoyeCode</span>
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
