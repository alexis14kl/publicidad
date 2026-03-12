import { useEffect, useState } from 'react'
import type { PreflightResult } from '../lib/types'

export function PreflightBanner() {
  const [result, setResult] = useState<PreflightResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    window.electronAPI
      .runPreflight()
      .then(setResult)
      .catch(() => setResult(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="preflight-banner preflight-banner--loading">
        Verificando dependencias...
      </div>
    )
  }

  if (!result || result.ok) return null

  const fails = result.checks.filter((c) => !c.ok)

  return (
    <div className="preflight-banner preflight-banner--error">
      <div className="preflight-banner__header" onClick={() => setCollapsed(!collapsed)}>
        <span className="preflight-banner__icon">!</span>
        <span className="preflight-banner__title">
          {fails.length} dependencia{fails.length > 1 ? 's' : ''} con problemas
        </span>
        <span className="preflight-banner__toggle">{collapsed ? '+' : '-'}</span>
      </div>

      {!collapsed && (
        <div className="preflight-banner__body">
          <table className="preflight-table">
            <thead>
              <tr>
                <th></th>
                <th>Dependencia</th>
                <th>Requerido</th>
                <th>Actual</th>
                <th>Solucion</th>
              </tr>
            </thead>
            <tbody>
              {result.checks.map((check) => (
                <tr key={check.name} className={check.ok ? 'preflight-row--ok' : 'preflight-row--fail'}>
                  <td>{check.ok ? '\u2714' : '\u2718'}</td>
                  <td>{check.name}</td>
                  <td>{check.required}</td>
                  <td>{check.current ?? 'No encontrado'}</td>
                  <td className="preflight-fix">{check.fix ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
