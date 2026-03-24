import { useEffect, useRef, useState } from 'react'
import type { ImageServiceSuggestion, PromptHistoryEntry } from '../../api/types'
import { IMAGE_FORMAT_GROUPS, NOYECODE_SERVICES } from '../../api/types'

interface ImageTabContentProps {
  imagePrompt: string
  onChangePrompt: (value: string) => void
  imageFormat: string
  onChangeFormat: (value: string) => void
  imageService: string
  onChangeService: (value: string) => void
  lastUsedService: string
  promptHistory: PromptHistoryEntry[]
  serviceSuggestions: ImageServiceSuggestion[]
  disabled: boolean
}

export function ImageTabContent({
  imagePrompt,
  onChangePrompt,
  imageFormat,
  onChangeFormat,
  imageService,
  onChangeService,
  lastUsedService,
  promptHistory,
  serviceSuggestions,
  disabled,
}: ImageTabContentProps) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)
  const hasPrompt = imagePrompt.trim().length > 0
  const relatedServices = serviceSuggestions.map((service) => ({ value: service.value, label: service.label }))
  const selectedServiceInfo =
    serviceSuggestions.find((service) => service.value === imageService) ||
    serviceSuggestions[0] ||
    null
  const fallbackServices = hasPrompt
    ? []
    : NOYECODE_SERVICES
        .map((service) => ({ value: service.value, label: service.label, emoji: service.emoji }))
        .filter((service) => !relatedServices.some((item) => item.value === service.value))

  useEffect(() => {
    if (!historyOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (historyRef.current && !historyRef.current.contains(target)) {
        setHistoryOpen(false)
      }
    }
    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [historyOpen])

  return (
    <div className="tab-content">
      <div className="tab-content__header">
        <span className="tab-content__title">Configuracion de imagen</span>
        <div ref={historyRef} className="prompt-tab__history">
          <button
            className="btn btn--small btn--ghost"
            onClick={() => setHistoryOpen((v) => !v)}
            disabled={promptHistory.length === 0}
            title={promptHistory.length === 0 ? 'No hay prompts guardados' : 'Ver ultimos 10 prompts'}
          >
            Historial
          </button>
          {historyOpen && (
            <div className="prompt-history" role="menu" aria-label="Historial de prompts">
              {promptHistory.slice(0, 10).map((entry, index) => {
                const dateLabel = entry.createdAt
                  ? new Date(entry.createdAt).toLocaleString('es-CO', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })
                  : 'Sin fecha'
                return (
                  <button
                    key={`${index}-${entry.text.slice(0, 20)}`}
                    className="prompt-history__item"
                    onClick={() => {
                      onChangePrompt(entry.text)
                      setHistoryOpen(false)
                    }}
                    type="button"
                  >
                    <span className="prompt-history__date">{dateLabel}</span>
                    <span className="prompt-history__text">{entry.text}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <label className="control-prompt">
        <span className="control-prompt__label">Pre-prompt</span>
        <textarea
          className="control-prompt__input"
          placeholder="Escribe primero de que trata la campana. Ej: 'videojuegos', 'desarrollador de software para empresas', 'veterinaria con peluqueria y comida para mascotas'..."
          value={imagePrompt}
          onChange={(e) => onChangePrompt(e.target.value)}
          rows={4}
          disabled={disabled}
        />
        <span className="control-prompt__hint">
          El analizador usa tu pre-prompt para cargar automaticamente los tipos de servicio relacionados.
        </span>
      </label>

      <div className="tab-content__controls">
        <div className="format-select format-select--stack">
          <label className="format-select__label" htmlFor="img-service">Tipo de servicio</label>
          <select
            id="img-service"
            className="format-select__input"
            value={imageService}
            onChange={(e) => onChangeService(e.target.value)}
            disabled={disabled}
          >
            {hasPrompt && relatedServices.length === 0 && (
              <option value="" disabled>
                El analizador esta buscando servicios relacionados...
              </option>
            )}
            {relatedServices.length > 0 && (
              <optgroup label="Servicios sugeridos por el analizador">
                {relatedServices.map((service) => (
                  <option key={service.value} value={service.value}>
                    {service.label}{service.value === lastUsedService ? ' (ultimo usado)' : ''}
                  </option>
                ))}
              </optgroup>
            )}
            {fallbackServices.length > 0 && (
              <optgroup label="Servicios generales">
                {fallbackServices.map((service) => (
                  <option key={service.value} value={service.value}>
                    {service.emoji} {service.label}{service.value === lastUsedService ? ' (ultimo usado)' : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {hasPrompt && (
            <span className="format-select__hint">
              {selectedServiceInfo?.reason || 'Escribe un poco mas de contexto para que el analizador cargue servicios mas precisos.'}
            </span>
          )}
        </div>

        <div className="format-select">
          <label className="format-select__label" htmlFor="img-format">Formato</label>
          <select
            id="img-format"
            className="format-select__input"
            value={imageFormat}
            onChange={(e) => onChangeFormat(e.target.value)}
            disabled={disabled}
          >
            {IMAGE_FORMAT_GROUPS.map((group) => (
              <optgroup key={group.platform} label={`${group.icon} ${group.platform}`}>
                {group.formats.map((fmt) => (
                  <option key={fmt.value} value={fmt.value}>
                    {group.platform} - {fmt.label} ({fmt.width}x{fmt.height})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
