const { normalizeUiText, formatGuiDateForSlash, formatGuiDateForLong, sleep, buildAliasPatterns } = require('../utils/helpers')
const { findVisibleLocator, findSectionRoot, fillNamedEditorInput, locateDynamicSection, clickRadioOptionInLocator, isRadioOptionSelectedInLocator, isRadioOptionSelectedInSection, selectDropdownOptionInLocator, readDropdownValueInLocator, readDropdownValueInSection, expandSectionIfNeeded, hasEditableDateInputs } = require('./ui-primitives')
const { resolveFacebookUiFlowRules, logFacebookUiStep, scrollEditorWorkArea, clickCampaignEditorNext } = require('./ui-campaign')

let state = { facebookVisualPage: null }

function setState(newState) {
  state = newState
}

function getPage() {
  return state.facebookVisualPage
}

async function getAdsetSchedulePanel(page) {
  const attempts = [
    { labels: ['Presupuesto y calendario', 'Budget and schedule'], mustContainTexts: ['Fecha de inicio'], controlType: 'input' },
    { labels: ['Presupuesto y calendario', 'Calendario', 'Budget and schedule', 'Schedule'], mustContainTexts: [], controlType: 'input' },
    { labels: ['Fecha de inicio', 'Fecha de finalización', 'Fecha de finalizacion'], mustContainTexts: [], controlType: 'input' },
  ]

  for (let attempt = 0; attempt < 4; attempt += 1) {
    for (const config of attempts) {
      const section = await locateDynamicSection(page, config, 2200).catch(() => null)
      if (section) {
        return section
      }
    }
    await scrollEditorWorkArea(page, attempt === 0 ? 500 : 900)
  }

  return null
}

async function getVisibleAdsetSectionNames(page) {
  return await page.evaluate(() => {
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
    const titles = Array.from(document.querySelectorAll('h1, h2, h3, h4, legend, label, div, span'))
      .filter(isVisible)
      .map((element) => String(element.innerText || element.textContent || '').trim())
      .filter(Boolean)
    const interesting = []
    const seen = new Set()
    for (const title of titles) {
      const text = normalize(title)
      if (
        text === 'conversion' ||
        text === 'ubicacion de la conversion' ||
        text === 'objetivo de rendimiento' ||
        text === 'presupuesto y calendario' ||
        text === 'conjunto de datos' ||
        text === 'objetivo de costo por resultado' ||
        text === 'reglas de valor' ||
        text === 'modelo de atribucion' ||
        text === 'modelo de atribución' ||
        text === 'contenido dinamico' ||
        text === 'contenido dinámico' ||
        text === 'publico' ||
        text === 'audiencia' ||
        text === 'segmentacion'
      ) {
        if (!seen.has(text)) {
          seen.add(text)
          interesting.push(title)
        }
      }
    }
    return interesting.slice(0, 12)
  }).catch(() => [])
}

async function findScheduleInput(root, labelText, fallbackIndex = 1, timeout = 2600) {
  const normalizedLabelText = String(labelText || '')
    .replace(/[áÁ]/g, 'a')
    .replace(/[éÉ]/g, 'e')
    .replace(/[íÍ]/g, 'i')
    .replace(/[óÓ]/g, 'o')
    .replace(/[úÚ]/g, 'u')
  const labelLower = normalizedLabelText.toLowerCase()
  return await findVisibleLocator(root, [
    (ctx) => ctx.locator(`xpath=(.//*[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚabcdefghijklmnopqrstuvwxyzáéíóú", "abcdefghijklmnopqrstuvwxyzaeiouabcdefghijklmnopqrstuvwxyzaeiou"), "${labelLower}") and not(contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚabcdefghijklmnopqrstuvwxyzáéíóú", "abcdefghijklmnopqrstuvwxyzaeiouabcdefghijklmnopqrstuvwxyzaeiou"), "definir una fecha"))])[1]/ancestor::*[self::div or self::section or self::label][1]//input[not(@type="checkbox") and not(@type="radio") and ((@type="date") or contains(translate(@placeholder, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "dd/mm/aaaa") or contains(translate(@aria-label, "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ", "abcdefghijklmnopqrstuvwxyzaeiou"), "fecha"))][1]`),
    (ctx) => ctx.getByLabel(new RegExp(labelText, 'i')),
    (ctx) => ctx.locator(`xpath=(.//*[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚabcdefghijklmnopqrstuvwxyzáéíóú", "abcdefghijklmnopqrstuvwxyzaeiouabcdefghijklmnopqrstuvwxyzaeiou"), "${labelLower}") and not(contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚabcdefghijklmnopqrstuvwxyzáéíóú", "abcdefghijklmnopqrstuvwxyzaeiouabcdefghijklmnopqrstuvwxyzaeiou"), "definir una fecha"))])[1]/ancestor::*[self::div or self::section or self::label][1]//input[not(@type="checkbox") and not(@type="radio")][${fallbackIndex}]`),
    (ctx) => ctx.locator(`xpath=(.//*[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚabcdefghijklmnopqrstuvwxyzáéíóú", "abcdefghijklmnopqrstuvwxyzaeiouabcdefghijklmnopqrstuvwxyzaeiou"), "${labelLower}") and not(contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚabcdefghijklmnopqrstuvwxyzáéíóú", "abcdefghijklmnopqrstuvwxyzaeiouabcdefghijklmnopqrstuvwxyzaeiou"), "definir una fecha"))])[1]/following::input[not(@type="checkbox") and not(@type="radio") and ((@type="date") or contains(translate(@placeholder, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "dd/mm/aaaa") or contains(translate(@aria-label, "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ", "abcdefghijklmnopqrstuvwxyzaeiou"), "fecha"))][1]`),
    (ctx) => ctx.locator(`xpath=(.//*[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚabcdefghijklmnopqrstuvwxyzáéíóú", "abcdefghijklmnopqrstuvwxyzaeiouabcdefghijklmnopqrstuvwxyzaeiou"), "${labelLower}")])[1]/following::input[not(@type="checkbox") and not(@type="radio")][${fallbackIndex}]`),
    (ctx) => ctx.locator(`input[aria-label*="${labelText}" i]`),
  ], timeout)
}

async function isScheduleDateAlreadySet(root, labelText, guiDate) {
  const expectedSlash = formatGuiDateForSlash(guiDate)
  const expectedLong = formatGuiDateForLong(guiDate)
  const expectedIso = String(guiDate || '').trim()
  return await root.evaluate((element, payload) => {
    const normalize = (text) => String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const isVisible = (node) => {
      if (!node) return false
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const labelNeedle = normalize(payload.labelText)
    const expectedValues = [payload.expectedSlash, payload.expectedLong, payload.expectedIso]
      .map(normalize)
      .filter(Boolean)
    const anchors = Array.from(element.querySelectorAll('label, div, span, p, strong'))
      .filter(isVisible)
      .filter((node) => normalize(node.innerText || node.textContent).includes(labelNeedle))
    for (const anchor of anchors) {
      const container = anchor.closest('section, div, label, form') || anchor.parentElement || element
      const bucket = Array.from(container.querySelectorAll('input, div, span'))
        .filter(isVisible)
        .map((node) => normalize(node.value || node.innerText || node.textContent || node.getAttribute?.('aria-label') || ''))
        .filter(Boolean)
      if (expectedValues.some((value) => bucket.some((candidate) => candidate.includes(value)))) {
        return true
      }
    }
    return false
  }, {
    labelText,
    expectedSlash,
    expectedLong,
    expectedIso,
  }).catch(() => false)
}

async function setDateInputValue(locator, guiDate) {
  const inputType = await locator.evaluate((element) => (element.getAttribute('type') || element.type || '').toLowerCase()).catch(() => '')
  const expectedValues = inputType === 'date'
    ? [String(guiDate).trim(), formatGuiDateForSlash(guiDate), formatGuiDateForLong(guiDate)]
    : [formatGuiDateForSlash(guiDate), formatGuiDateForLong(guiDate), String(guiDate).trim()]
  const verifyDateValue = async () => {
    const currentValue = await locator.evaluate((element) => {
      const bucket = [
        element.value,
        element.getAttribute('value'),
        element.getAttribute('aria-label'),
        element.getAttribute('placeholder'),
        element.textContent,
      ]
      return bucket.find((item) => String(item || '').trim()) || ''
    }).catch(() => '')
    const normalizedCurrentValue = normalizeUiText(currentValue)
    return expectedValues.some((candidate) => normalizedCurrentValue.includes(normalizeUiText(candidate)))
  }

  for (const value of expectedValues) {
    try {
      await locator.click({ timeout: 5000, force: true })
      await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {})
      await locator.fill(value)
      await locator.press('Tab').catch(() => {})
      await sleep(180)
      if (await verifyDateValue()) {
        return
      }
    } catch {
      // Try the next representation.
    }
  }

  for (const value of expectedValues) {
    try {
      await locator.click({ timeout: 5000, force: true })
      await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {})
      await locator.type(value, { delay: 45 })
      await locator.press('Tab').catch(() => {})
      await sleep(220)
      if (await verifyDateValue()) {
        return
      }
    } catch {
      // Try DOM setter below.
    }
  }

  const finalValue = inputType === 'date' ? String(guiDate).trim() : formatGuiDateForSlash(guiDate)
  await locator.evaluate((element, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    if (descriptor?.set) {
      descriptor.set.call(element, value)
    } else {
      element.value = value
    }
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new Event('blur', { bubbles: true }))
  }, finalValue)
  await sleep(220)
  if (!await verifyDateValue()) {
    throw new Error(`No pude confirmar que la fecha ${guiDate} quedara escrita en el campo.`)
  }
}

async function enableAdsetEndDate(root) {
  const alreadyVisible = await root.evaluate((element) => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const isVisible = (node) => {
      if (!node) return false
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const endSection = Array.from(element.querySelectorAll('label, div, span, p, strong'))
      .filter(isVisible)
      .find((node) => normalize(node.innerText || node.textContent).includes('fecha de finalizacion'))
    if (!endSection) return false
    const container = endSection.closest('section, div, label, form') || endSection.parentElement || element
    return Array.from(container.querySelectorAll('input'))
      .filter(isVisible)
      .some((input) => {
        const type = normalize(input.getAttribute('type') || input.type || '')
        const placeholder = normalize(input.getAttribute('placeholder'))
        const ariaLabel = normalize(input.getAttribute('aria-label'))
        return type !== 'checkbox' && type !== 'radio' && (
          type === 'date' ||
          placeholder.includes('dd/mm/aaaa') ||
          ariaLabel.includes('fecha')
        )
      })
  }).catch(() => false)

  if (alreadyVisible) {
    return
  }

  const endCheckbox = await findVisibleLocator(root, [
    (ctx) => ctx.getByRole('checkbox', { name: /definir una fecha de finalizaci[oó]n/i }),
    (ctx) => ctx.locator('label, div, span, button').filter({ hasText: /definir una fecha de finalizaci[oó]n/i }),
  ], 2000)

  if (endCheckbox) {
    const checked = await endCheckbox.evaluate((element) => {
      if (element.matches?.('input[type="checkbox"]')) {
        return Boolean(element.checked)
      }
      const nested = element.querySelector?.('input[type="checkbox"]')
      return Boolean(nested?.checked) || element.getAttribute('aria-checked') === 'true'
    }).catch(() => false)
    if (!checked) {
      await endCheckbox.click({ timeout: 5000, force: true }).catch(() => {})
    }
    const appeared = await findScheduleInput(root, 'Fecha de finalización', 1, 2500).catch(() => null)
    if (!appeared) {
      await sleep(900)
    }
    return
  }

  const toggled = await root.evaluate(() => {
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
    const target = Array.from(document.querySelectorAll('label, div, span, button'))
      .filter(isVisible)
      .find((element) => {
        const text = normalize(element.innerText || element.textContent)
        return text === 'definir una fecha de finalizacion' || text.includes('definir una fecha de finalizacion')
      })
    if (!target) return false
    target.click()
    return true
  }).catch(() => false)

  if (!toggled) {
    throw new Error('No pude habilitar la fecha de finalización del conjunto de anuncios.')
  }
  await sleep(900)
}

async function tryFacebookUiConfigureAdsetSchedule(preview) {
  if (!getPage() || getPage().isClosed()) {
    return {
      anySuccess: false,
      conversionConfigured: false,
      performanceConfigured: false,
      scheduleConfigured: false,
      nextClicked: false,
      visibleSections: [],
      canAdvance: false,
    }
  }

  const page = getPage()
  await page.bringToFront()
  await page.waitForTimeout(2400)
  const uiRules = resolveFacebookUiFlowRules(preview, preview?.orchestrator || null)
  let anySuccess = false
  let conversionConfigured = false
  let performanceConfigured = false
  let scheduleConfigured = false
  let startDateConfigured = false
  let endDateConfigured = false
  const conversionAliases = [
    ...(Array.isArray(uiRules.conversionLocationAliases) ? uiRules.conversionLocationAliases : []),
    'Sitio web y formularios instantáneos',
    'Sitio web y formularios instantaneos',
    'Website and instant forms',
  ]
  const performanceAliases = [
    uiRules.performanceGoalLabel,
    'Maximizar el número de clientes potenciales',
    'Maximizar el numero de clientes potenciales',
    'Maximizar clientes potenciales',
    'Maximizar el número de conversiones',
    'Maximizar el numero de conversiones',
    'Maximizar conversiones',
    'Maximize number of leads',
    'Maximize number of conversions',
    'Leads',
    'Conversions',
  ].filter(Boolean)
  const performanceSectionPattern = /objetivo de rendimiento|performance goal/i

  const adsetReady = await findVisibleLocator(page, [
    (ctx) => ctx.getByText(/nombre del conjunto de anuncios|conjunto de anuncios|ad set|ubicacion de la conversion|presupuesto y calendario/i),
    (ctx) => ctx.locator('section, div').filter({ hasText: /nombre del conjunto de anuncios|conjunto de anuncios|ad set|ubicacion de la conversion|presupuesto y calendario/i }),
  ], 7000)

  if (!adsetReady) {
    await logFacebookUiStep('No encontre la pantalla del conjunto de anuncios despues de configurar la campaña.', 'warning')
    return {
      anySuccess: false,
      conversionConfigured: false,
      performanceConfigured: false,
      scheduleConfigured: false,
      nextClicked: false,
      visibleSections: [],
      canAdvance: false,
    }
  }

  let visibleSections = await getVisibleAdsetSectionNames(page)
  if (visibleSections.length > 0) {
    await logFacebookUiStep(`Apartados visibles del conjunto de anuncios: ${visibleSections.join(' | ')}.`)
  }

  try {
    await fillNamedEditorInput(page, {
      labelPattern: /nombre del conjunto de anuncios|ad set name/i,
      sectionPattern: /nombre del conjunto de anuncios|ad set name/i,
      labelTexts: ['Nombre del conjunto de anuncios', 'Ad set name'],
      sectionTexts: ['Nombre del conjunto de anuncios', 'Ad set name'],
      value: uiRules.adsetName,
      allowFirstVisibleFallback: false,
      selectors: [
        'input[aria-label*="conjunto de anuncios" i]',
        'input[placeholder*="conjunto de anuncios" i]',
        'input[aria-label*="ad set" i]',
        'input[placeholder*="ad set" i]',
      ],
      errorMessage: 'No encontre el campo de nombre del conjunto de anuncios.',
    })
    await logFacebookUiStep(`Nombre del conjunto de anuncios corregido en la UI: ${uiRules.adsetName}.`)
    await page.waitForTimeout(700)
    anySuccess = true
  } catch (error) {
    await logFacebookUiStep(`No pude corregir el nombre del conjunto de anuncios: ${error.message || error}`, 'warning')
  }

  const conversionSection = await locateDynamicSection(page, {
    labels: ['Ubicación de la conversión', 'Ubicacion de la conversion', 'Conversion location'],
    controlType: 'radio',
  }, 3000).catch(() => null)

  try {
    if (!conversionSection) {
      throw new Error(`No encontre la seccion de conversion para "${uiRules.conversionLocationLabel}".`)
    }
    await clickRadioOptionInLocator(
      conversionSection,
      page,
      conversionAliases,
      `No encontre la opcion de conversion "${uiRules.conversionLocationLabel}".`
    )
    await logFacebookUiStep(`Ubicacion de conversion fijada por regla del orquestador: ${uiRules.conversionLocationLabel}.`)
    await page.waitForTimeout(1200)
    anySuccess = true
    conversionConfigured = true
  } catch (error) {
    const alreadySelected = conversionSection
      ? await isRadioOptionSelectedInLocator(conversionSection, conversionAliases)
      : await isRadioOptionSelectedInSection(page, /ubicacion de la conversion|conversion/i, conversionAliases)
    if (alreadySelected) {
      await logFacebookUiStep('La ubicacion de conversion ya venia seleccionada en el conjunto de anuncios.')
      anySuccess = true
      conversionConfigured = true
    } else {
      await logFacebookUiStep(`No pude seleccionar la ubicacion de conversion del conjunto de anuncios: ${error.message || error}`, 'warning')
    }
  }

  const performanceSection = await locateDynamicSection(page, {
    labels: ['Objetivo de rendimiento', 'Performance goal'],
    controlType: 'combobox',
  }, 3000).catch(() => null)

  try {
    if (!performanceSection) {
      throw new Error(`No encontre la seccion de objetivo de rendimiento para "${uiRules.performanceGoalLabel}".`)
    }
    await selectDropdownOptionInLocator(
      performanceSection,
      page,
      performanceAliases,
      `No encontre el selector de objetivo de rendimiento para "${uiRules.performanceGoalLabel}".`
    )
    await logFacebookUiStep(`Objetivo de rendimiento alineado con la regla del orquestador: ${uiRules.performanceGoalLabel}.`)
    await page.waitForTimeout(900)
    anySuccess = true
    performanceConfigured = true
  } catch (error) {
    const currentValue = performanceSection
      ? await readDropdownValueInLocator(performanceSection)
      : await readDropdownValueInSection(page, performanceSectionPattern)
    const normalizedCurrentValue = String(currentValue || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
    const currentValueMatches = performanceAliases.some((alias) => {
      const normalizedAlias = String(alias || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
      return normalizedAlias && normalizedCurrentValue.includes(normalizedAlias)
    })
    if (currentValueMatches) {
      await logFacebookUiStep(`El objetivo de rendimiento ya estaba definido como "${currentValue || uiRules.performanceGoalLabel}".`)
      anySuccess = true
      performanceConfigured = true
    } else {
      await logFacebookUiStep(`No pude ajustar el objetivo de rendimiento del conjunto de anuncios: ${error.message || error}`, 'warning')
    }
  }

  const schedulePanel = await getAdsetSchedulePanel(page)
  if (!schedulePanel) {
    await logFacebookUiStep('No encontre la seccion Presupuesto y calendario del conjunto de anuncios.', 'warning')
    return {
      anySuccess,
      conversionConfigured,
      performanceConfigured,
      scheduleConfigured,
      nextClicked: false,
      visibleSections,
      canAdvance: false,
    }
  }

  const refreshedSections = await getVisibleAdsetSectionNames(page)
  if (refreshedSections.length > 0 && refreshedSections.join('|') !== visibleSections.join('|')) {
    visibleSections = refreshedSections
    await logFacebookUiStep(`Apartados visibles del conjunto de anuncios tras buscar calendario: ${visibleSections.join(' | ')}.`)
  }

  await expandSectionIfNeeded(page, /presupuesto y calendario|presupuesto|calendario|programacion|budget|schedule/i)
  const hasEditableDates = await hasEditableDateInputs(schedulePanel)
  if (!hasEditableDates) {
    await logFacebookUiStep('No vi campos editables de fecha en Presupuesto y calendario; seguire con la configuracion visible del conjunto de anuncios.')
    scheduleConfigured = true
  }

  if (hasEditableDates) {
    try {
      const startInput = await findScheduleInput(schedulePanel, 'Fecha de inicio', 1, 4000)
      if (startInput) {
        await setDateInputValue(startInput, preview?.startDate)
        await logFacebookUiStep(`Fecha de inicio del conjunto de anuncios ajustada a ${preview?.startDate}.`)
        await page.waitForTimeout(700)
        anySuccess = true
        startDateConfigured = true
      } else {
        const alreadySet = await isScheduleDateAlreadySet(schedulePanel, 'Fecha de inicio', preview?.startDate)
        if (!alreadySet) {
          throw new Error('No encontre el campo de Fecha de inicio.')
        }
        await logFacebookUiStep(`La fecha de inicio del conjunto de anuncios ya estaba en ${preview?.startDate}.`)
        startDateConfigured = true
      }
    } catch (error) {
      await logFacebookUiStep(`No pude configurar la fecha de inicio del conjunto de anuncios: ${error.message || error}`, 'warning')
    }

    try {
      await enableAdsetEndDate(schedulePanel)
      await page.waitForTimeout(700)
      const endInput = await findScheduleInput(schedulePanel, 'Fecha de finalización', 1, 4000)
      if (endInput) {
        await setDateInputValue(endInput, preview?.endDate)
        await logFacebookUiStep(`Fecha de finalización del conjunto de anuncios ajustada a ${preview?.endDate}.`)
        await page.waitForTimeout(800)
        anySuccess = true
        endDateConfigured = true
      } else {
        const alreadySet = await isScheduleDateAlreadySet(schedulePanel, 'Fecha de finalización', preview?.endDate)
        if (!alreadySet) {
          throw new Error('No encontre el campo de Fecha de finalización.')
        }
        await logFacebookUiStep(`La fecha de finalización del conjunto de anuncios ya estaba en ${preview?.endDate}.`)
        endDateConfigured = true
      }
    } catch (error) {
      await logFacebookUiStep(`No pude configurar la fecha de finalización del conjunto de anuncios: ${error.message || error}`, 'warning')
    }
  }

  const conversionVisible = visibleSections.some((item) => /conversion|ubicacion de la conversion/i.test(String(item)))
  const performanceVisible = visibleSections.some((item) => /objetivo de rendimiento/i.test(String(item)))
  const scheduleVisible = visibleSections.some((item) => /presupuesto y calendario|presupuesto/i.test(String(item)))
  if (hasEditableDates) {
    scheduleConfigured = startDateConfigured && endDateConfigured
  }
  const scheduleRelevant = scheduleVisible || Boolean(schedulePanel)
  const canAdvance =
    (!conversionVisible || conversionConfigured) &&
    (!performanceVisible || performanceConfigured) &&
    (!scheduleRelevant || scheduleConfigured)

  if (!canAdvance) {
    await logFacebookUiStep('No dare click en Siguiente todavia porque faltan apartados visibles del conjunto de anuncios por completar.', 'warning')
    return {
      anySuccess,
      conversionConfigured,
      performanceConfigured,
      scheduleConfigured,
      nextClicked: false,
      visibleSections,
      canAdvance,
    }
  }

  let nextClicked = false
  try {
    await clickCampaignEditorNext(page)
    await logFacebookUiStep('Conjunto de anuncios configurado; avanzando al siguiente paso.')
    await page.waitForTimeout(1800)
    anySuccess = true
    nextClicked = true
  } catch (error) {
    await logFacebookUiStep(`No pude avanzar despues de configurar el calendario del conjunto de anuncios: ${error.message || error}`, 'warning')
  }

  return {
    anySuccess,
    conversionConfigured,
    performanceConfigured,
    scheduleConfigured,
    nextClicked,
    visibleSections,
    canAdvance,
  }
}

module.exports = {
  setState,
  getAdsetSchedulePanel,
  getVisibleAdsetSectionNames,
  findScheduleInput,
  isScheduleDateAlreadySet,
  setDateInputValue,
  enableAdsetEndDate,
  tryFacebookUiConfigureAdsetSchedule,
}
