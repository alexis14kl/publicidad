interface SettingsPageProps {
  onBack?: () => void
  brandName?: string
  brandLogoUrl?: string | null
}

export function SettingsPage({ }: SettingsPageProps) {
  return (
    <div className="settings-page">
      <div className="settings-header">
        <div className="settings-header-left">
          <h2 className="settings-title">Configuraciones</h2>
        </div>
      </div>
      <div className="settings-body" />
    </div>
  )
}
