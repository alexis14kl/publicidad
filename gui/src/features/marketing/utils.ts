export function buildMarketingPromptPreview(params: {
  campaignIdea: string
  city: string
  zones: string[]
  contactMode: 'lead_form' | 'whatsapp'
  budget: string
  startDate: string
  endDate: string
}) {
  const campaignIdea = params.campaignIdea.trim()
  const city = params.city.trim()
  const zonesLabel = params.zones.length > 0 ? params.zones.join(', ') : 'toda la ciudad'
  const contactLabel = params.contactMode === 'whatsapp'
    ? 'generar conversaciones por WhatsApp'
    : 'captar clientes potenciales desde el sitio web'
  const objectiveLabel = params.contactMode === 'whatsapp' ? 'Mensajes / WhatsApp' : 'Clientes potenciales'
  const budgetLabel = params.budget.trim() || 'pendiente'
  const dateLabel = params.startDate && params.endDate
    ? `${params.startDate} -> ${params.endDate}`
    : 'pendiente'

  if (!campaignIdea || !city) return ''

  return [
    `Quiero una campana de Facebook Ads para "${campaignIdea}".`,
    `Ciudad objetivo: ${city}.`,
    `Zonas prioritarias: ${zonesLabel}.`,
    `Objetivo principal: ${objectiveLabel}.`,
    `Canal de contacto: ${contactLabel}.`,
    `Presupuesto estimado: ${budgetLabel}.`,
    `Fechas de campana: ${dateLabel}.`,
    'Genera un brief completo usando el ads-analyst, image-creator y marketing con esta estructura:',
    '1. copy sugerido del anuncio',
    '2. publico recomendado',
    '3. hook principal',
    '4. CTA recomendado',
    '5. direccion visual de la imagen',
    '6. recomendacion de segmentacion local',
    `La imagen debe estar directamente relacionada con "${campaignIdea}" y sentirse coherente con ${city}.`,
  ].join('\n')
}
