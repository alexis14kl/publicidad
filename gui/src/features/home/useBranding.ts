import { useEffect, useState } from 'react'
import { listCompanyRecords } from '../../shared/api/commands'
import type { CompanyRecord } from '../../shared/api/types'

export function useBranding() {
  const [brandName, setBrandName] = useState('NoyeCode')
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null)

  const applyBrandFromCompanies = (companies: CompanyRecord[]) => {
    const ordered = [...companies].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    const preferred = ordered.find((company) => company.logo_url) || ordered[0]

    if (!preferred) {
      setBrandName('NoyeCode')
      setBrandLogoUrl(null)
      return
    }

    setBrandName(preferred.nombre || 'NoyeCode')
    setBrandLogoUrl(preferred.logo_url || null)
  }

  const refreshBrand = async () => {
    try {
      const companies = await listCompanyRecords()
      applyBrandFromCompanies(companies)
    } catch {
      setBrandName('NoyeCode')
      setBrandLogoUrl(null)
    }
  }

  useEffect(() => {
    void refreshBrand()
  }, [])

  return {
    brandLogoUrl,
    brandName,
    refreshBrand,
  }
}
