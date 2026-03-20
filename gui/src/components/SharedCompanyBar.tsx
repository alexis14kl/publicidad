import type { CompanyRecord } from '../shared/api/types'

const PLATFORM_EMOJIS: Record<string, string> = {
  facebook: '\uD83D\uDCD8',
  instagram: '\uD83D\uDCF7',
  linkedin: '\uD83D\uDCBC',
  tiktok: '\uD83C\uDFB5',
  googleads: '\uD83D\uDCCA',
}

interface SharedCompanyBarProps {
  companies: CompanyRecord[]
  selectedCompany: string
  onChangeCompany: (value: string) => void
  publishPlatforms: Record<string, boolean>
  onTogglePlatform: (platform: string) => void
  disabled: boolean
}

export function SharedCompanyBar({
  companies,
  selectedCompany,
  onChangeCompany,
  publishPlatforms,
  onTogglePlatform,
  disabled,
}: SharedCompanyBarProps) {
  const activeCompany = companies.find((c) => c.nombre === selectedCompany) || null
  const platforms = Array.isArray(activeCompany?.platforms) ? activeCompany.platforms : []

  return (
    <div className="shared-company-bar glass-card">
      <div className="shared-company-bar__row">
        <div className="shared-company-bar__select">
          <label className="shared-company-bar__label" htmlFor="shared-company">Empresa</label>
          <select
            id="shared-company"
            className="format-select__input"
            value={selectedCompany}
            onChange={(e) => onChangeCompany(e.target.value)}
            disabled={disabled || companies.length === 0}
          >
            {companies.length === 0 ? (
              <option value="">Sin empresas registradas</option>
            ) : (
              companies.map((c) => {
                const info = [c.sitio_web || 'xxxxxx', c.telefono || 'xxxxxx'].join(' | ')
                return (
                  <option key={c.nombre} value={c.nombre}>
                    {c.nombre} ({info})
                  </option>
                )
              })
            )}
          </select>
        </div>

        {platforms.length > 0 && (
          <div className="shared-company-bar__platforms">
            <span className="shared-company-bar__label">Publicar en</span>
            <div className="shared-company-bar__checks">
              {platforms.map((p) => (
                <label key={p.platform} className="publish-platforms__check">
                  <input
                    type="checkbox"
                    checked={!!publishPlatforms[p.platform]}
                    onChange={() => onTogglePlatform(p.platform)}
                    disabled={disabled}
                  />
                  <span className="publish-platforms__name">
                    {PLATFORM_EMOJIS[p.platform] || ''} {p.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
