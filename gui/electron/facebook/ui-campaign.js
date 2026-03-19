const { normalizeUiText, buildAliasPatterns, normalizeBudgetForUi, ensureAbsoluteUrl, getDefaultLeadFormFieldLabels, getDefaultLeadFormRequiredKeys } = require('../utils/helpers')
const { getProjectEnv } = require('../utils/env')
const { findVisibleLocator, findSectionRoot, fillNamedEditorInput, locateDynamicSection, fillVisibleInput } = require('./ui-primitives')
const { getDefaultMarketingSegment } = require('../marketing/segment')

let state = { facebookVisualPage: null }

function setState(newState) {
  state = newState
}

function getPage() {
  return state.facebookVisualPage
}

let emitMarketingUpdate = () => {}

function setEmitMarketingUpdate(fn) {
  emitMarketingUpdate = fn
}

async function logFacebookUiStep(message, status = 'running') {
  emitMarketingUpdate({
    type: 'log',
    status,
    line: `[FACEBOOK-UI] ${message}`,
    summary: 'Automatizando Ads Manager en navegador normal.',
  })
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function clickObjectiveInCampaignModal(page, objectiveRule) {
  const modal = await findVisibleLocator(page, [
    (ctx) => ctx.locator('[role="dialog"]'),
    (ctx) => ctx.locator('[aria-modal="true"]'),
  ], 5000)

  const searchRoot = modal || page
  const objectivePattern = new RegExp(objectiveRule.uiAliases.join('|'), 'i')

  const directHit = await findVisibleLocator(searchRoot, [
    (ctx) => ctx.getByRole('radio', { name: objectivePattern }),
    (ctx) => ctx.locator('[role="radio"]').filter({ hasText: objectivePattern }),
    (ctx) => ctx.locator('label').filter({ hasText: objectivePattern }),
    (ctx) => ctx.getByText(objectivePattern),
  ], 2200)

  if (directHit) {
    try {
      await directHit.click({ timeout: 6000, force: true })
      return {
        ok: true,
        method: 'locator',
        label: objectiveRule.uiLabel,
      }
    } catch {
      // fall through to DOM strategy
    }
  }

  return page.evaluate((payload) => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const labels = (payload?.uiAliases || []).map(normalize).filter(Boolean)
    const isVisible = (element) => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const roots = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).filter(isVisible)
    const root = roots.find((element) => {
      const text = normalize(element.textContent)
      return text.includes('crear nueva campana') || text.includes('elige un objetivo')
    }) || roots[0] || document.body

    const all = Array.from(root.querySelectorAll('*')).filter(isVisible)
    const pickClickable = (element) => {
      const chain = [
        element,
        element?.closest?.('[role="radio"]'),
        element?.closest?.('label'),
        element?.closest?.('button'),
        element?.closest?.('[role="button"]'),
        element?.closest?.('li'),
        element?.closest?.('div'),
      ].filter(Boolean)
      return chain.find((candidate) => candidate !== root && isVisible(candidate)) || null
    }

    for (const label of labels) {
      const match = all.find((element) => {
        const text = normalize(element.innerText || element.textContent)
        return text === label || text.startsWith(label) || text.includes(label)
      })
      if (!match) continue
      const clickable = pickClickable(match)
      if (!clickable) continue
      clickable.click()
      return {
        ok: true,
        method: 'dom-click',
        label: payload.uiLabel,
        matchedText: String(match.innerText || match.textContent || '').trim(),
      }
    }

    return {
      ok: false,
      label: payload.uiLabel,
    }
  }, objectiveRule)
}

async function continueCampaignCreationModal(page) {
  const modal = await findVisibleLocator(page, [
    (ctx) => ctx.locator('[role="dialog"]'),
    (ctx) => ctx.locator('[aria-modal="true"]'),
  ], 5000)
  const searchRoot = modal || page
  const continueButton = await findVisibleLocator(searchRoot, [
    (ctx) => ctx.getByRole('button', { name: /continuar|continue|siguiente|next/i }),
    (ctx) => ctx.locator('button, [role="button"]').filter({ hasText: /continuar|continue|siguiente|next/i }),
  ], 3000)

  if (!continueButton) {
    throw new Error('No encontre el boton Continuar del modal de campaña.')
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await continueButton.isEnabled().catch(() => false)) {
      await continueButton.click({ timeout: 5000, force: true })
      return
    }
    await page.waitForTimeout(500)
  }

  throw new Error('El boton Continuar no se habilito despues de seleccionar el objetivo.')
}

async function clickBudgetTypeTrigger(root) {
  const trigger = await findVisibleLocator(root, [
    (ctx) => ctx.getByRole('button', { name: /presupuesto de la campana|presupuesto del conjunto de anuncios|presupuesto diario|presupuesto total|campaign budget|ad set budget|daily budget|lifetime budget/i }),
    (ctx) => ctx.locator('button, [role="button"], [aria-haspopup="listbox"], [aria-expanded]').filter({ hasText: /presupuesto de la campana|presupuesto del conjunto de anuncios|presupuesto diario|presupuesto total|campaign budget|ad set budget|daily budget|lifetime budget/i }),
  ], 2600)

  if (trigger) {
    await trigger.click({ timeout: 5000, force: true })
    return true
  }

  return root.evaluate(() => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const isVisible = (element) => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const all = Array.from(document.querySelectorAll('button, [role="button"], [aria-haspopup="listbox"], [aria-expanded], div'))
      .filter(isVisible)
    const match = all.find((element) => {
      const text = normalize(element.innerText || element.textContent)
      return (
        text === 'presupuesto diario' ||
        text === 'daily budget' ||
        text === 'presupuesto total' ||
        text === 'lifetime budget' ||
        text === 'presupuesto de la campana' ||
        text === 'campaign budget' ||
        text === 'presupuesto del conjunto de anuncios' ||
        text === 'ad set budget'
      )
    })
    if (!match) return false
    match.click()
    return true
  })
}

async function selectTotalBudgetMode(page, aliases = ['Presupuesto de la campaña', 'Campaign budget', 'Presupuesto total', 'Lifetime budget']) {
  const budgetSection = await findSectionRoot(page, /presupuesto|budget/i, 2400).catch(() => null)
  if (budgetSection) {
    await budgetSection.scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(250)
  }

  // Newer Meta Ads flows use radios/segmented controls instead of a dropdown.
  const optionPattern = new RegExp(aliases.join('|'), 'i')
  const directOption = await findVisibleLocator(budgetSection || page, [
    (ctx) => ctx.getByRole('radio', { name: optionPattern }),
    (ctx) => ctx.locator('[role="radio"]').filter({ hasText: optionPattern }),
    (ctx) => ctx.locator('label').filter({ hasText: optionPattern }),
    (ctx) => ctx.getByText(optionPattern),
  ], 1600)
  if (directOption) {
    await directOption.click({ timeout: 5000, force: true })
    return
  }

  const triggerClicked = await clickBudgetTypeTrigger(budgetSection || page)
  if (!triggerClicked) {
    throw new Error('No encontre el selector del tipo de presupuesto.')
  }

  await page.waitForTimeout(600)

  const totalOption = await findVisibleLocator(page, [
    (ctx) => ctx.getByRole('option', { name: optionPattern }),
    (ctx) => ctx.getByRole('menuitem', { name: optionPattern }),
    (ctx) => ctx.locator('[role="option"], [role="menuitem"], li, button, div').filter({ hasText: optionPattern }),
  ], 2200)

  if (totalOption) {
    await totalOption.click({ timeout: 5000, force: true })
    return
  }

  const changed = await page.evaluate((payload) => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const aliases = (payload.aliases || []).map(normalize).filter(Boolean)
    const isVisible = (element) => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const match = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, button, div'))
      .filter(isVisible)
      .find((element) => {
        const text = normalize(element.innerText || element.textContent)
        return aliases.some((alias) => text === alias || text.includes(alias))
      })
    if (!match) return false
    match.click()
    return true
  }, { aliases })

  if (!changed) {
    throw new Error('No pude cambiar el selector a Presupuesto total.')
  }
}

async function selectCampaignBudgetAmountMode(page, aliases = ['Presupuesto diario', 'Daily budget']) {
  const budgetSection = await findSectionRoot(page, /presupuesto|budget/i, 2600).catch(() => null)
  if (budgetSection) {
    await budgetSection.scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(250)
  }

  const optionPattern = new RegExp(aliases.join('|'), 'i')
  const trigger = await findVisibleLocator(budgetSection || page, [
    (ctx) => ctx.getByRole('button', { name: /presupuesto diario|presupuesto total|daily budget|lifetime budget/i }),
    (ctx) => ctx.locator('[role="combobox"], [aria-haspopup="listbox"], button, div[role="button"]').filter({ hasText: /presupuesto diario|presupuesto total|daily budget|lifetime budget/i }),
  ], 2600)

  if (trigger) {
    const alreadySelected = await trigger.textContent().catch(() => '')
    if (optionPattern.test(String(alreadySelected || ''))) {
      return
    }
    await trigger.click({ timeout: 5000, force: true })
    await page.waitForTimeout(450)
  } else {
    throw new Error('No encontre el selector interno de Presupuesto diario/total.')
  }

  const option = await findVisibleLocator(page, [
    (ctx) => ctx.getByRole('option', { name: optionPattern }),
    (ctx) => ctx.getByRole('menuitem', { name: optionPattern }),
    (ctx) => ctx.locator('[role="option"], [role="menuitem"], li, button, div').filter({ hasText: optionPattern }),
  ], 2400)

  if (option) {
    await option.click({ timeout: 5000, force: true })
    await page.waitForTimeout(450)
    return
  }

  const changed = await page.evaluate((payload) => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const labels = (payload.aliases || []).map(normalize).filter(Boolean)
    const isVisible = (element) => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const match = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, button, div'))
      .filter(isVisible)
      .find((element) => {
        const text = normalize(element.innerText || element.textContent)
        return labels.some((label) => text === label || text.includes(label))
      })
    if (!match) return false
    match.click()
    return true
  }, { aliases })

  if (!changed) {
    throw new Error(`No pude cambiar el selector interno a ${aliases[0] || 'Presupuesto diario'}.`)
  }
}

function resolveCampaignObjectiveRule(preview, orchestrator = null) {
  const candidates = [
    { source: 'preview.objective', value: preview?.objective },
    { source: 'orchestrator.execution.campaignType', value: orchestrator?.execution?.campaignType },
    { source: 'orchestrator.adsAnalyst.objective', value: orchestrator?.adsAnalyst?.objective },
  ]

  for (const candidate of candidates) {
    const normalized = normalizeUiText(candidate.value)
    if (!normalized) continue
    if (
      normalized.includes('lead') ||
      normalized.includes('cliente potencial') ||
      normalized.includes('clientes potenciales') ||
      normalized.includes('instant form')
    ) {
      return {
        apiObjective: 'OUTCOME_LEADS',
        uiLabel: 'Clientes potenciales',
        uiAliases: ['Clientes potenciales', 'Lead generation', 'Leads'],
        source: candidate.source,
      }
    }
    if (
      normalized.includes('whatsapp') ||
      normalized.includes('mensaje') ||
      normalized.includes('mensajes') ||
      normalized.includes('message') ||
      normalized.includes('messages') ||
      normalized.includes('interaccion')
    ) {
      return {
        apiObjective: 'OUTCOME_ENGAGEMENT',
        uiLabel: 'Interaccion',
        uiAliases: ['Interaccion', 'Engagement', 'Messages', 'Mensajes'],
        source: candidate.source,
      }
    }
  }

  return {
    apiObjective: 'OUTCOME_LEADS',
    uiLabel: 'Clientes potenciales',
    uiAliases: ['Clientes potenciales', 'Lead generation', 'Leads'],
    source: 'runner.default.objective',
  }
}

function resolveFacebookUiFlowRules(preview, orchestrator = null) {
  const objectiveRule = resolveCampaignObjectiveRule(preview, orchestrator)
  const segment = orchestrator?.execution?.segment || getDefaultMarketingSegment()
  const conversionAliases = Array.isArray(orchestrator?.execution?.conversionLocationUiAliases)
    ? orchestrator.execution.conversionLocationUiAliases.map((value) => String(value || '').trim()).filter(Boolean)
    : []
  const budgetModeAliases = Array.isArray(orchestrator?.execution?.budgetModeUiAliases)
    ? orchestrator.execution.budgetModeUiAliases.map((value) => String(value || '').trim()).filter(Boolean)
    : []

  return {
    campaignName: buildDraftCampaignName(preview, orchestrator),
    campaignObjectiveLabel: String(orchestrator?.execution?.objectiveUiLabel || objectiveRule.uiLabel).trim() || objectiveRule.uiLabel,
    campaignObjectiveAliases: objectiveRule.uiAliases,
    budgetModeLabel: String(orchestrator?.execution?.budgetModeUiLabel || '').trim() || 'Presupuesto de la campaña',
    budgetModeAliases: budgetModeAliases.length > 0 ? budgetModeAliases : [
      'Presupuesto de la campaña',
      'Campaign budget',
      'Presupuesto total',
      'Lifetime budget',
    ],
    budgetAmountModeLabel: String(orchestrator?.execution?.budgetAmountModeUiLabel || '').trim() || 'Presupuesto diario',
    budgetAmountModeAliases: Array.isArray(orchestrator?.execution?.budgetAmountModeUiAliases)
      ? orchestrator.execution.budgetAmountModeUiAliases.map((value) => String(value || '').trim()).filter(Boolean)
      : ['Presupuesto diario', 'Daily budget'],
    budgetAmount: normalizeBudgetForUi(preview?.budget),
    adsetName: buildDraftAdsetName(preview, orchestrator),
    adName: buildDraftAdName(preview, orchestrator),
    conversionLocationLabel: String(orchestrator?.execution?.conversionLocationUiLabel || '').trim() || 'Sitio web y formularios instantáneos',
    conversionLocationAliases: conversionAliases.length > 0 ? conversionAliases : [
      'Sitio web y formularios instantáneos',
      'Sitio web y formularios instantaneos',
      'Website and instant forms',
      'Formularios instantáneos',
      'Instant forms',
      'Instant form',
    ],
    performanceGoalLabel: String(orchestrator?.execution?.performanceGoalUiLabel || '').trim() || 'Maximizar el número de clientes potenciales',
    audienceLocationLabel: String(segment?.country || 'Colombia').trim() || 'Colombia',
    leadFormFieldLabels: Array.isArray(orchestrator?.execution?.leadFormFieldLabels)
      ? orchestrator.execution.leadFormFieldLabels.map((field) => String(field || '').trim()).filter(Boolean)
      : getDefaultLeadFormFieldLabels(),
    leadFormRequiredKeys: Array.isArray(orchestrator?.execution?.leadFormRequiredKeys)
      ? orchestrator.execution.leadFormRequiredKeys.map((field) => String(field || '').trim()).filter(Boolean)
      : getDefaultLeadFormRequiredKeys(),
  }
}

function buildDraftCampaignName(preview, orchestrator = null) {
  const explicitName = String(
    orchestrator?.execution?.campaignName ||
    orchestrator?.adsAnalyst?.campaignName ||
    ''
  ).trim()
  if (explicitName) {
    return explicitName
  }

  const segmentLabel = orchestrator?.execution?.segment?.shortLabel || getDefaultMarketingSegment().shortLabel
  return `Lead Gen | ${segmentLabel} | ${preview.startDate} -> ${preview.endDate}`
}

function buildDraftAdsetName(preview, orchestrator = null) {
  const explicitName = String(
    orchestrator?.execution?.adsetName ||
    orchestrator?.adsAnalyst?.adsetName ||
    ''
  ).trim()
  if (explicitName) {
    return explicitName
  }

  const segmentLabel = orchestrator?.execution?.segment?.shortLabel || getDefaultMarketingSegment().shortLabel
  return `Conjunto Leads | ${segmentLabel} | ${preview.startDate} -> ${preview.endDate}`
}

function buildDraftAdName(preview, orchestrator = null) {
  const explicitName = String(
    preview?.adDraftConfig?.adName ||
    orchestrator?.execution?.adName ||
    orchestrator?.adsAnalyst?.adName ||
    ''
  ).trim()
  if (explicitName) {
    return explicitName
  }

  const segmentLabel = orchestrator?.execution?.segment?.shortLabel || getDefaultMarketingSegment().shortLabel
  return `Anuncio Leads | ${segmentLabel} | ${preview.startDate} -> ${preview.endDate}`
}

function buildDraftLeadFormName(preview, orchestrator = null) {
  const explicitName = String(
    orchestrator?.execution?.leadFormName ||
    preview?.selectedLeadgenFormName ||
    ''
  ).trim()
  if (explicitName) {
    return explicitName
  }

  const segmentLabel = orchestrator?.execution?.segment?.shortLabel || getDefaultMarketingSegment().shortLabel
  return `Formulario | ${segmentLabel} | ${preview.startDate} -> ${preview.endDate}`
}

async function tryFacebookUiCreateCampaign(preview) {
  if (!getPage() || getPage().isClosed()) {
    return false
  }

  const page = getPage()
  await page.bringToFront()
  await page.waitForTimeout(1500)

  try {
    await logFacebookUiStep('Buscando boton Crear en Ads Manager...')
    const createButton = page.locator('button, div[role="button"], a').filter({
      hasText: /crear|create/i,
    }).first()
    await createButton.waitFor({ timeout: 10000 })
    await createButton.click({ timeout: 10000 })
    await logFacebookUiStep('Boton Crear presionado.')
    await page.waitForTimeout(1500)
  } catch (error) {
    await logFacebookUiStep(`No pude presionar el boton Crear: ${error.message || error}`, 'warning')
    return false
  }

  try {
    const uiRules = resolveFacebookUiFlowRules(preview, preview?.orchestrator || null)
    const objectiveRule = resolveCampaignObjectiveRule(preview, preview?.orchestrator || null)
    await logFacebookUiStep(`Regla activa: seleccionar "${uiRules.campaignObjectiveLabel}" desde ${objectiveRule.source} antes de continuar.`)
    const objectiveSelection = await clickObjectiveInCampaignModal(page, objectiveRule)
    if (!objectiveSelection?.ok) {
      throw new Error(`No pude localizar la tarjeta del objetivo "${uiRules.campaignObjectiveLabel}" en el modal.`)
    }
    await logFacebookUiStep(`Objetivo de campaña seleccionado en la UI: ${uiRules.campaignObjectiveLabel}.`)
    await page.waitForTimeout(900)

    await continueCampaignCreationModal(page)
    await logFacebookUiStep('Modal de objetivo completado; avanzando al siguiente paso de creación.')
    await page.waitForTimeout(1800)
  } catch (error) {
    await logFacebookUiStep(`No pude completar el modal de objetivo de campaña: ${error.message || error}`, 'warning')
    return false
  }

  try {
    const uiRules = resolveFacebookUiFlowRules(preview, preview?.orchestrator || null)
    await fillNamedEditorInput(page, {
      labelPattern: /nombre de la campa|campaign name/i,
      sectionPattern: /nombre de la campa|campaign name/i,
      labelTexts: ['Nombre de la campaña', 'Campaign name'],
      sectionTexts: ['Nombre de la campaña', 'Campaign name'],
      value: uiRules.campaignName,
      allowFirstVisibleFallback: false,
      selectors: [
        'input[aria-label*="campa" i]',
        'input[placeholder*="campa" i]',
        'input[aria-label*="campaign" i]',
        'input[placeholder*="campaign" i]',
      ],
      errorMessage: 'No encontre un campo visible para el nombre de la campaña.',
    })
    await logFacebookUiStep(`Nombre de campana rellenado en UI: ${uiRules.campaignName}`)
  } catch (error) {
    await logFacebookUiStep(`No pude rellenar el nombre de la campana en la UI: ${error.message || error}`, 'warning')
  }

  return true
}

async function tryFacebookUiConfigureCampaignEditor(preview) {
  if (!getPage() || getPage().isClosed()) {
    return { nameFilled: false, budgetConfigured: false, nextClicked: false }
  }

  const page = getPage()
  await page.bringToFront()
  await page.waitForTimeout(2200)
  const uiRules = resolveFacebookUiFlowRules(preview, preview?.orchestrator || null)
  let nameFilled = false
  let budgetConfigured = false
  let nextClicked = false

  try {
    await fillNamedEditorInput(page, {
      labelPattern: /nombre de la campa|campaign name/i,
      sectionPattern: /nombre de la campa|campaign name/i,
      labelTexts: ['Nombre de la campaña', 'Campaign name'],
      sectionTexts: ['Nombre de la campaña', 'Campaign name'],
      value: uiRules.campaignName,
      allowFirstVisibleFallback: false,
      selectors: [
        'input[aria-label*="campa" i]',
        'input[placeholder*="campa" i]',
        'input[aria-label*="campaign" i]',
        'input[placeholder*="campaign" i]',
      ],
      errorMessage: 'No encontre el campo de nombre en el editor de campaña.',
    })
    await logFacebookUiStep(`Nombre de campaña corregido en el editor: ${uiRules.campaignName}`)
    nameFilled = true
  } catch (error) {
    await logFacebookUiStep(`No pude corregir el nombre de campaña en el editor: ${error.message || error}`, 'warning')
  }

  try {
    await selectTotalBudgetMode(page, uiRules.budgetModeAliases)
    await logFacebookUiStep(`Tipo de presupuesto cambiado a ${uiRules.budgetModeLabel}.`)
    await page.waitForTimeout(700)
    await selectCampaignBudgetAmountMode(page, uiRules.budgetAmountModeAliases)
    await logFacebookUiStep(`Selector interno de presupuesto cambiado a ${uiRules.budgetAmountModeLabel}.`)
    await page.waitForTimeout(500)
    await fillCampaignBudgetValue(page, preview?.budget)
    await logFacebookUiStep(`Presupuesto diario rellenado con el valor de la GUI: ${uiRules.budgetAmount}.`)
    await page.waitForTimeout(900)
    budgetConfigured = true
  } catch (error) {
    await logFacebookUiStep(`No pude configurar el presupuesto diario en el editor: ${error.message || error}`, 'warning')
  }

  if (!budgetConfigured) {
    await logFacebookUiStep('No dare click en Siguiente todavia porque el presupuesto de campaña no quedo configurado.', 'warning')
    return { nameFilled, budgetConfigured, nextClicked }
  }

  try {
    await clickCampaignEditorNext(page)
    await logFacebookUiStep('Campaña configurada; avanzando al siguiente paso del editor.')
    await page.waitForTimeout(1800)
    nextClicked = true
  } catch (error) {
    await logFacebookUiStep(`No pude avanzar al siguiente paso del editor de campaña: ${error.message || error}`, 'warning')
  }

  return { nameFilled, budgetConfigured, nextClicked }
}

async function tryFacebookUiOpenCampaignFromList(preview) {
  if (!getPage() || getPage().isClosed()) {
    return false
  }

  const page = getPage()
  await page.bringToFront()
  await page.waitForTimeout(1800)

  const uiRules = resolveFacebookUiFlowRules(preview, preview?.orchestrator || null)
  const campaignName = String(uiRules.campaignName || '').trim()
  if (!campaignName) {
    return false
  }

  const namePattern = new RegExp(escapeRegex(campaignName), 'i')
  const rowHit = await findVisibleLocator(page, [
    (ctx) => ctx.getByText(namePattern),
    (ctx) => ctx.locator('[role="row"], a, div, span').filter({ hasText: namePattern }),
  ], 4500)

  if (!rowHit) {
    await logFacebookUiStep(`No encontre la campaña "${campaignName}" en el listado para reabrirla.`, 'warning')
    return false
  }

  await rowHit.click({ timeout: 5000, force: true }).catch(() => {})
  await page.waitForTimeout(1200)
  await rowHit.dblclick({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1600)

  const editButton = await findVisibleLocator(page, [
    (ctx) => ctx.getByRole('button', { name: /^editar$|^edit$/i }),
    (ctx) => ctx.getByRole('button', { name: /editar|edit/i }),
    (ctx) => ctx.locator('button, [role="button"]').filter({ hasText: /editar|edit/i }),
  ], 2200)

  if (editButton) {
    await editButton.click({ timeout: 5000, force: true }).catch(() => {})
    await page.waitForTimeout(2200)
  }

  const editorReady = await findVisibleLocator(page, [
    (ctx) => ctx.locator('input[aria-label*="campa" i], input[placeholder*="campa" i], input[aria-label*="campaign" i], input[placeholder*="campaign" i]'),
    (ctx) => ctx.locator('section, div').filter({ hasText: /nombre de la campa|campaign name|presupuesto/i }),
  ], 4200)

  if (editorReady) {
    await logFacebookUiStep(`Campaña reabierta desde el listado: ${campaignName}.`)
    return true
  }

  await logFacebookUiStep(`No pude confirmar la reapertura del editor para "${campaignName}".`, 'warning')
  return false
}

async function fillCampaignBudgetValue(page, budgetValue) {
  const normalizedBudget = normalizeBudgetForUi(budgetValue)
  const budgetSection = await locateDynamicSection(page, {
    labels: ['Presupuesto'],
    mustContainTexts: ['COP'],
    controlType: 'input',
  }, 3200).catch(() => null)
  if (budgetSection) {
    await budgetSection.scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(250)
  }
  if (!budgetSection) {
    throw new Error('No encontre la seccion de presupuesto monetario de la campaña.')
  }

  const input = await findVisibleLocator(budgetSection, [
    (ctx) => ctx.locator('xpath=.//input[not(@type="hidden") and not(@type="checkbox") and not(@type="radio") and not(@readonly)][ancestor::*[self::div or self::section][contains(translate(normalize-space(.), "ÁÉÍÓÚáéíóú", "AEIOUaeiou"), "cop")]][1]'),
    (ctx) => ctx.locator('xpath=.//input[not(@type="hidden") and not(@type="checkbox") and not(@type="radio") and not(@readonly)][ancestor::*[self::div or self::section][contains(translate(normalize-space(.), "ÁÉÍÓÚáéíóú", "AEIOUaeiou"), "presupuesto diario") or contains(translate(normalize-space(.), "ÁÉÍÓÚáéíóú", "AEIOUaeiou"), "presupuesto total")]][1]'),
    (ctx) => ctx.locator('input[aria-label*="cop" i], input[placeholder*="cop" i]'),
  ], 2600)

  if (input) {
    try {
      await input.click({ timeout: 5000, force: true })
      await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {})
      await input.fill(normalizedBudget)
      await input.press('Tab').catch(() => {})
      return
    } catch {
      // fall through to DOM setter
    }
  }

  const setByDom = await budgetSection.evaluate((root, value) => {
    const normalize = (text) => String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const isVisible = (element) => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const candidates = Array.from(root.querySelectorAll('input'))
      .filter(isVisible)
      .filter((element) => {
        if (element.disabled || element.readOnly) return false
        const type = normalize(element.getAttribute('type') || element.type || '')
        if (['checkbox', 'radio', 'hidden', 'button', 'submit', 'reset', 'file', 'image'].includes(type)) return false
        const label = normalize(element.getAttribute('aria-label'))
        const placeholder = normalize(element.getAttribute('placeholder'))
        const valueText = normalize(element.value)
        const parentText = normalize(element.closest('section, form, div')?.textContent)
        return (
          label.includes('cop') ||
          placeholder.includes('cop') ||
          parentText.includes('presupuesto diario') ||
          parentText.includes('presupuesto total') ||
          parentText.includes('cop')
        )
      })
    const target =
      candidates.find((element) => normalize(element.closest('div, section, form')?.textContent).includes('cop')) ||
      candidates.find((element) => normalize(element.closest('div, section, form')?.textContent).includes('presupuesto diario')) ||
      candidates.find((element) => normalize(element.closest('div, section, form')?.textContent).includes('presupuesto total')) ||
      candidates.find((element) => /^\d[\d.,]*$/.test(String(element.value || '').trim()))
    if (!target) return false
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    if (descriptor?.set) {
      descriptor.set.call(target, value)
    } else {
      target.value = value
    }
    target.dispatchEvent(new Event('input', { bubbles: true }))
      target.dispatchEvent(new Event('change', { bubbles: true }))
      target.dispatchEvent(new Event('blur', { bubbles: true }))
      return true
  }, normalizedBudget)

  if (!setByDom) {
    throw new Error('No pude escribir el presupuesto maximo en el campo monetario de la campaña.')
  }
}

async function clickCampaignEditorNext(page) {
  // Meta often places navigation buttons in a sticky footer; ensure we're near the bottom.
  await page.evaluate(() => {
    try { window.scrollTo(0, document.body.scrollHeight) } catch {}
  }).catch(() => {})
  await page.waitForTimeout(300)

  const nextButton = await findVisibleLocator(page, [
    (ctx) => ctx.getByRole('button', { name: /siguiente|next|continuar|continue|guardar|save/i }),
    (ctx) => ctx.locator('button, [role="button"]').filter({ hasText: /siguiente|next|continuar|continue|guardar|save/i }),
    (ctx) => ctx.locator('div[role="button"], a').filter({ hasText: /siguiente|next|continuar|continue|guardar|save/i }),
  ], 3000)
  if (!nextButton) {
    const clicked = await page.evaluate(() => {
      const normalize = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
      const isVisible = (element) => {
        if (!element) return false
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }
      const match = Array.from(document.querySelectorAll('button, [role="button"], a, div'))
        .filter(isVisible)
        .find((element) => {
          const text = normalize(element.innerText || element.textContent)
          return text === 'siguiente' || text === 'next' || text === 'continuar' || text === 'continue'
        })
      if (!match) return false
      match.click()
      return true
    }).catch(() => false)
    if (clicked) {
      return
    }
    throw new Error('No encontre el boton Siguiente en el editor de campaña.')
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await nextButton.isEnabled().catch(() => false)) {
      await nextButton.click({ timeout: 5000, force: true })
      return
    }
    await page.waitForTimeout(450)
  }

  throw new Error('El boton Siguiente no se habilito despues de configurar la campaña.')
}

async function scrollEditorWorkArea(page, amount = 900) {
  await page.evaluate((step) => {
    const isVisible = (element) => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const isScrollable = (element) => {
      if (!element || element === document.body || element === document.documentElement) return false
      const style = window.getComputedStyle(element)
      const overflowY = style.overflowY || style.overflow || ''
      return /(auto|scroll|overlay)/i.test(overflowY) && element.scrollHeight > element.clientHeight + 120
    }
    const candidates = Array.from(document.querySelectorAll('div, section, main, aside'))
      .filter(isVisible)
      .filter(isScrollable)
      .sort((a, b) => {
        const aScore = (a.clientHeight * a.clientWidth) + a.scrollHeight
        const bScore = (b.clientHeight * b.clientWidth) + b.scrollHeight
        return bScore - aScore
      })
      .slice(0, 6)

    for (const element of candidates) {
      try {
        element.scrollBy({ top: step, behavior: 'instant' })
      } catch {
        element.scrollTop += step
      }
    }

    try {
      window.scrollBy(0, step)
    } catch {}
  }, amount).catch(() => {})
  await page.waitForTimeout(450)
}

module.exports = {
  setState,
  setEmitMarketingUpdate,
  logFacebookUiStep,
  clickObjectiveInCampaignModal,
  continueCampaignCreationModal,
  clickBudgetTypeTrigger,
  selectTotalBudgetMode,
  selectCampaignBudgetAmountMode,
  resolveCampaignObjectiveRule,
  resolveFacebookUiFlowRules,
  buildDraftCampaignName,
  buildDraftAdsetName,
  buildDraftAdName,
  buildDraftLeadFormName,
  tryFacebookUiCreateCampaign,
  tryFacebookUiOpenCampaignFromList,
  tryFacebookUiConfigureCampaignEditor,
  fillCampaignBudgetValue,
  clickCampaignEditorNext,
  scrollEditorWorkArea,
}
