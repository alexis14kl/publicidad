const { buildAliasPatterns, normalizeUiText } = require('../utils/helpers')

async function findVisibleLocator(page, builders, timeout = 1800) {
  for (const build of builders) {
    try {
      const locator = build(page).first()
      await locator.waitFor({ state: 'visible', timeout })
      return locator
    } catch {
      // Try the next selector.
    }
  }
  return null
}

async function findSectionRoot(page, pattern, timeout = 4000) {
  return await findVisibleLocator(page, [
    (ctx) => ctx.locator('section, div').filter({ hasText: pattern }),
  ], timeout)
}

async function locateDynamicSection(page, {
  labels = [],
  mustContainTexts = [],
  controlType = 'any',
} = {}, timeout = 2600) {
  const scopeId = `scope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const found = await page.evaluate((payload) => {
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
    const labels = Array.isArray(payload.labels) ? payload.labels.map(normalize).filter(Boolean) : []
    const mustContainTexts = Array.isArray(payload.mustContainTexts) ? payload.mustContainTexts.map(normalize).filter(Boolean) : []
    const supportsControlType = (element) => {
      if (!element) return false
      if (payload.controlType === 'radio') {
        return Array.from(element.querySelectorAll('[role="radio"], input[type="radio"]')).some(isVisible)
      }
      if (payload.controlType === 'combobox') {
        return Array.from(element.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"], button')).some(isVisible)
      }
      if (payload.controlType === 'input') {
        return Array.from(element.querySelectorAll('input, textarea'))
          .filter(isVisible)
          .some((field) => {
            const type = normalize(field.getAttribute('type') || field.type || '')
            return !['checkbox', 'radio', 'hidden', 'button', 'submit', 'reset', 'file', 'image'].includes(type)
          })
      }
      return true
    }
    Array.from(document.querySelectorAll('[data-noye-scope]')).forEach((element) => element.removeAttribute('data-noye-scope'))
    const candidates = Array.from(document.querySelectorAll('section, div'))
      .filter(isVisible)
      .filter((element) => {
        const text = normalize(element.innerText || element.textContent)
        if (labels.length > 0 && !labels.some((label) => text.includes(label))) return false
        if (mustContainTexts.length > 0 && !mustContainTexts.every((label) => text.includes(label))) return false
        return supportsControlType(element)
      })
      .sort((a, b) => normalize(a.innerText || a.textContent).length - normalize(b.innerText || b.textContent).length)
    const winner = candidates[0]
    if (!winner) return false
    winner.setAttribute('data-noye-scope', payload.scopeId)
    return true
  }, { labels, mustContainTexts, controlType, scopeId }).catch(() => false)

  if (!found) {
    return null
  }

  const locator = page.locator(`[data-noye-scope="${scopeId}"]`).first()
  try {
    await locator.waitFor({ state: 'visible', timeout })
    return locator
  } catch {
    return null
  }
}

async function isRadioOptionSelectedInLocator(scope, aliases = []) {
  return await scope.evaluate((root, payload) => {
    const normalize = (text) => String(text || '')
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
    const candidates = Array.from(root.querySelectorAll('[role="radio"], input[type="radio"], label, button, div'))
      .filter(isVisible)
    return candidates.some((element) => {
      const checked =
        element.getAttribute('aria-checked') === 'true' ||
        element.matches?.('input[type="radio"]:checked') ||
        Boolean(element.querySelector?.('input[type="radio"]:checked'))
      if (!checked) return false
      const text = normalize(element.innerText || element.textContent || element.getAttribute?.('aria-label') || '')
      return labels.some((label) => text === label || text.startsWith(label) || text.includes(label))
    })
  }, { aliases }).catch(() => false)
}

async function clickRadioOptionInLocator(scope, page, aliases, errorMessage) {
  const aliasPatterns = buildAliasPatterns(aliases)
  const option = await findVisibleLocator(scope, [
    (ctx) => ctx.getByRole('radio', { name: aliasPatterns.exactPattern }),
    (ctx) => ctx.locator('[role="radio"]').filter({ hasText: aliasPatterns.exactPattern }),
    (ctx) => ctx.locator('label').filter({ hasText: aliasPatterns.exactPattern }),
    (ctx) => ctx.getByRole('radio', { name: aliasPatterns.loosePattern }),
    (ctx) => ctx.locator('[role="radio"]').filter({ hasText: aliasPatterns.loosePattern }),
    (ctx) => ctx.locator('label').filter({ hasText: aliasPatterns.loosePattern }),
  ], 2400)
  if (option) {
    await option.click({ timeout: 5000, force: true }).catch(() => {})
    await page.waitForTimeout(700)
    if (await isRadioOptionSelectedInLocator(scope, aliasPatterns.aliases)) {
      return
    }
  }

  const clicked = await scope.evaluate((root, payload) => {
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
    const labels = (payload.aliases || []).map(normalize).filter(Boolean)
    const all = Array.from(root.querySelectorAll('*')).filter(isVisible)
    const match = all.find((element) => {
      const text = normalize(element.innerText || element.textContent)
      return labels.some((label) => text === label || text.startsWith(`${label} `))
    }) || all.find((element) => {
      const text = normalize(element.innerText || element.textContent)
      return labels.some((label) => text === label || text.startsWith(label) || text.includes(label))
    })
    if (!match) return false
    const clickable = [
      match.closest('[role="radio"]'),
      match.closest('label'),
      match.closest('button'),
      match.closest('[role="button"]'),
      match.closest('div'),
    ].find((element) => element && isVisible(element))
    if (!clickable) return false
    clickable.click()
    return true
  }, { aliases: aliasPatterns.aliases }).catch(() => false)

  if (!clicked) {
    throw new Error(errorMessage)
  }

  await page.waitForTimeout(700)
  if (!await isRadioOptionSelectedInLocator(scope, aliasPatterns.aliases)) {
    throw new Error(errorMessage)
  }
}

async function readDropdownValueInLocator(scope) {
  const trigger = await findVisibleLocator(scope, [
    (ctx) => ctx.getByRole('combobox'),
    (ctx) => ctx.locator('[role="combobox"], [aria-haspopup="listbox"], button, div[role="button"]'),
  ], 1600)
  if (!trigger) return ''
  return String(await trigger.textContent().catch(() => '') || '').trim()
}

async function selectDropdownOptionInLocator(scope, page, aliases, errorMessage) {
  const aliasPatterns = buildAliasPatterns(aliases)
  const trigger = await findVisibleLocator(scope, [
    (ctx) => ctx.getByRole('combobox'),
    (ctx) => ctx.locator('[role="combobox"], [aria-haspopup="listbox"], button, div[role="button"]'),
  ], 2600)

  if (!trigger) {
    throw new Error(errorMessage)
  }

  const alreadySelected = String(await trigger.textContent().catch(() => '') || '')
  if (aliasPatterns.loosePattern.test(alreadySelected)) {
    return
  }

  await trigger.click({ timeout: 5000, force: true }).catch(() => {})
  await page.waitForTimeout(500)

  const option = await findVisibleLocator(page, [
    (ctx) => ctx.getByRole('option', { name: aliasPatterns.exactPattern }),
    (ctx) => ctx.getByRole('menuitem', { name: aliasPatterns.exactPattern }),
    (ctx) => ctx.locator('[role="option"], [role="menuitem"], li, button, div').filter({ hasText: aliasPatterns.exactPattern }),
    (ctx) => ctx.getByRole('option', { name: aliasPatterns.loosePattern }),
    (ctx) => ctx.getByRole('menuitem', { name: aliasPatterns.loosePattern }),
    (ctx) => ctx.locator('[role="option"], [role="menuitem"], li, button, div').filter({ hasText: aliasPatterns.loosePattern }),
  ], 2600)

  if (option) {
    await option.click({ timeout: 5000, force: true }).catch(() => {})
    await page.waitForTimeout(700)
  } else {
    const clicked = await page.evaluate((payload) => {
      const normalize = (text) => String(text || '')
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
          return labels.some((label) => text === label || text.startsWith(`${label} `))
        }) || Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, button, div'))
        .filter(isVisible)
        .find((element) => {
          const text = normalize(element.innerText || element.textContent)
          return labels.some((label) => text === label || text.includes(label))
        })
      if (!match) return false
      match.click()
      return true
    }, { aliases: aliasPatterns.aliases }).catch(() => false)
    if (!clicked) {
      throw new Error(errorMessage)
    }
  }

  const currentValue = await readDropdownValueInLocator(scope)
  const normalizedCurrentValue = normalizeUiText(currentValue)
  const isMatch = aliasPatterns.aliases.some((alias) => normalizedCurrentValue.includes(normalizeUiText(alias)))
  if (!isMatch) {
    throw new Error(errorMessage)
  }
}

async function fillVisibleInput(locator, value) {
  // Guardrail: avoid trying to `.fill()` checkboxes/radios (Meta Ads UI often nests them near inputs).
  const inputType = await locator.evaluate((element) => {
    if (!element) return ''
    const tag = String(element.tagName || '').toLowerCase()
    if (tag !== 'input') return ''
    return String(element.getAttribute('type') || element.type || '').toLowerCase()
  }).catch(() => '')
  if (inputType === 'checkbox' || inputType === 'radio') {
    throw new Error(`Input of type "${inputType}" cannot be filled`)
  }

  await locator.click({ timeout: 5000, force: true })
  await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {})
  await locator.fill(value)
  await locator.press('Tab').catch(() => {})
}

async function fillNamedEditorInput(page, config) {
  const {
    labelPattern,
    sectionPattern,
    value,
    selectors = [],
    labelTexts = [],
    sectionTexts = [],
    errorMessage,
    useLabelLookup = true,
    allowFirstVisibleFallback = false,
  } = config

  const section = sectionPattern ? await findSectionRoot(page, sectionPattern, 4200) : null
  const scopedBuilders = [
    ...(useLabelLookup ? [(ctx) => ctx.getByLabel(labelPattern)] : []),
    ...selectors.map((selector) => (ctx) => ctx.locator(selector)),
    // Avoid checkbox/radio fallbacks that cause `locator.fill` to throw.
    (ctx) => ctx.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])'),
    (ctx) => ctx.locator('textarea'),
  ]

  const input = section
    ? await findVisibleLocator(section, scopedBuilders, 2600)
    : await findVisibleLocator(page, scopedBuilders, 4200)

  if (input) {
    await fillVisibleInput(input, value)
    return
  }

  const setByDom = await page.evaluate((payload) => {
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

    const sectionLabels = Array.isArray(payload.sectionTexts)
      ? payload.sectionTexts.map(normalize).filter(Boolean)
      : []
    const fieldLabels = Array.isArray(payload.labelTexts)
      ? payload.labelTexts.map(normalize).filter(Boolean)
      : []
    const roots = Array.from(document.querySelectorAll('section, div')).filter((element) => {
      const text = normalize(element.textContent)
      return isVisible(element) && (sectionLabels.length === 0 || sectionLabels.some((label) => text.includes(label)))
    })
    const searchRoot = roots[0] || document.body
    const inputs = Array.from(searchRoot.querySelectorAll('input, textarea'))
      .filter(isVisible)
      .filter((element) => {
        const tag = String(element.tagName || '').toLowerCase()
        if (tag === 'textarea') return true
        if (tag !== 'input') return false
        const type = normalize(element.getAttribute('type') || element.type || '')
        if (!type) return true // default is text
        return !['checkbox', 'radio', 'hidden', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color'].includes(type)
      })
    const target = inputs.find((element) => {
      const parentText = normalize(element.closest('section, form, div')?.textContent)
      const ariaLabel = normalize(element.getAttribute('aria-label'))
      const placeholder = normalize(element.getAttribute('placeholder'))
      return fieldLabels.some((label) => ariaLabel.includes(label) || placeholder.includes(label) || parentText.includes(label))
    }) || (payload.allowFirstVisibleFallback ? inputs[0] : null)

    if (!target) return false

    const tag = String(target.tagName || '').toLowerCase()
    const proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
    if (descriptor?.set) descriptor.set.call(target, payload.value)
    else target.value = payload.value
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    target.dispatchEvent(new Event('blur', { bubbles: true }))
    return true
  }, {
    labelTexts,
    sectionTexts,
    value,
    allowFirstVisibleFallback,
  })

  if (!setByDom) {
    throw new Error(errorMessage)
  }
}

async function clickRadioOptionInSection(page, sectionPattern, aliases, errorMessage) {
  const section = await findSectionRoot(page, sectionPattern, 5000).catch(() => null)
  const searchRoot = section || page
  const aliasPatterns = buildAliasPatterns(aliases)
  if (section) {
    await section.scrollIntoViewIfNeeded().catch(() => {})
  }
  const optionPattern = aliasPatterns.loosePattern
  const option = await findVisibleLocator(searchRoot, [
    (ctx) => ctx.getByRole('radio', { name: aliasPatterns.exactPattern }),
    (ctx) => ctx.locator('[role="radio"]').filter({ hasText: aliasPatterns.exactPattern }),
    (ctx) => ctx.locator('label').filter({ hasText: aliasPatterns.exactPattern }),
    (ctx) => ctx.getByRole('radio', { name: optionPattern }),
    (ctx) => ctx.locator('[role="radio"]').filter({ hasText: optionPattern }),
    (ctx) => ctx.locator('label').filter({ hasText: optionPattern }),
    (ctx) => ctx.locator('button, [role="button"], div, span').filter({ hasText: optionPattern }),
    (ctx) => ctx.getByText(optionPattern),
  ], 2800)

  if (option) {
    await option.click({ timeout: 5000, force: true })
    await page.waitForTimeout(700)
    const selected = await isRadioOptionSelectedInSection(page, sectionPattern, aliasPatterns.aliases)
    if (selected) {
      return
    }
  }

  const clicked = section
    ? await section.evaluate((root, payload) => {
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
      const labels = (payload.aliases || []).map(normalize).filter(Boolean)
      const all = Array.from(root.querySelectorAll('*')).filter(isVisible)
      const match = all.find((element) => {
        const text = normalize(element.innerText || element.textContent)
        return labels.some((label) => text === label || text.startsWith(`${label} `))
      }) || all.find((element) => {
        const text = normalize(element.innerText || element.textContent)
        return labels.some((label) => text === label || text.startsWith(label) || text.includes(label))
      })
      if (!match) return false
      const clickable = [
        match.closest('[role="radio"]'),
        match.closest('label'),
        match.closest('button'),
        match.closest('[role="button"]'),
        match.closest('div'),
      ].find((element) => element && isVisible(element))
      if (!clickable) return false
      clickable.click()
      return true
    }, { aliases: aliasPatterns.aliases })
    : await page.evaluate((payload) => {
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
      const labels = (payload.aliases || []).map(normalize).filter(Boolean)
      const all = Array.from(document.querySelectorAll('*')).filter(isVisible)
      const match = all.find((element) => {
        const text = normalize(element.innerText || element.textContent)
        return labels.some((label) => text === label || text.startsWith(`${label} `))
      }) || all.find((element) => {
        const text = normalize(element.innerText || element.textContent)
        return labels.some((label) => text === label || text.startsWith(label) || text.includes(label))
      })
      if (!match) return false
      const clickable = [
        match.closest('[role="radio"]'),
        match.closest('label'),
        match.closest('button'),
        match.closest('[role="button"]'),
        match.closest('div'),
      ].find((element) => element && isVisible(element))
      if (!clickable) return false
      clickable.click()
      return true
    }, { aliases: aliasPatterns.aliases })

  if (!clicked) {
    throw new Error(errorMessage)
  }

  await page.waitForTimeout(700)
  const selected = await isRadioOptionSelectedInSection(page, sectionPattern, aliasPatterns.aliases)
  if (!selected) {
    throw new Error(errorMessage)
  }
}

async function selectDropdownOptionInSection(page, sectionPattern, aliases, errorMessage) {
  const section = await findSectionRoot(page, sectionPattern, 4500).catch(() => null)
  const searchRoot = section || page
  const aliasPatterns = buildAliasPatterns(aliases)
  if (section) {
    await section.scrollIntoViewIfNeeded().catch(() => {})
  }
  const trigger = await findVisibleLocator(searchRoot, [
    (ctx) => ctx.getByRole('combobox'),
    (ctx) => ctx.locator('[role="combobox"], [aria-haspopup="listbox"], button').filter({ hasText: /maximizar|lead|conversion|resultado|cliente potencial|whatsapp/i }),
    (ctx) => ctx.locator('[role="combobox"], [aria-haspopup="listbox"], button'),
  ], 2600)

  if (!trigger) {
    return await clickRadioOptionInSection(page, sectionPattern, aliases, errorMessage)
  }

  await trigger.click({ timeout: 5000, force: true })
  await page.waitForTimeout(500)

  const optionPattern = aliasPatterns.loosePattern
  const option = await findVisibleLocator(page, [
    (ctx) => ctx.getByRole('option', { name: aliasPatterns.exactPattern }),
    (ctx) => ctx.getByRole('menuitem', { name: aliasPatterns.exactPattern }),
    (ctx) => ctx.locator('[role="option"], [role="menuitem"], li, button, div').filter({ hasText: aliasPatterns.exactPattern }),
    (ctx) => ctx.getByRole('option', { name: optionPattern }),
    (ctx) => ctx.getByRole('menuitem', { name: optionPattern }),
    (ctx) => ctx.locator('[role="option"], [role="menuitem"], li, button, div').filter({ hasText: optionPattern }),
  ], 2500)

  if (option) {
    await option.click({ timeout: 5000, force: true })
    await page.waitForTimeout(700)
    const currentValue = await readDropdownValueInSection(page, sectionPattern)
    const normalizedCurrentValue = normalizeUiText(currentValue)
    const isMatch = aliasPatterns.aliases.some((alias) => normalizedCurrentValue.includes(normalizeUiText(alias)))
    if (isMatch) {
      return
    }
  }

  const clicked = await page.evaluate((payload) => {
    const normalize = (text) => String(text || '')
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
        return labels.some((label) => text === label || text.startsWith(`${label} `))
      }) || Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, button, div'))
      .filter(isVisible)
      .find((element) => {
        const text = normalize(element.innerText || element.textContent)
        return labels.some((label) => text === label || text.includes(label))
      })
    if (!match) return false
    match.click()
    return true
  }, { aliases: aliasPatterns.aliases })

  if (!clicked) {
    throw new Error(errorMessage)
  }

  await page.waitForTimeout(700)
  const currentValue = await readDropdownValueInSection(page, sectionPattern)
  const normalizedCurrentValue = normalizeUiText(currentValue)
  const isMatch = aliasPatterns.aliases.some((alias) => normalizedCurrentValue.includes(normalizeUiText(alias)))
  if (!isMatch) {
    throw new Error(errorMessage)
  }
}

async function isRadioOptionSelectedInSection(page, sectionPattern, aliases = []) {
  const section = await findSectionRoot(page, sectionPattern, 2600).catch(() => null)
  const searchRoot = section || page
  const selected = await (section
    ? section.evaluate((root, payload) => {
      const normalize = (text) => String(text || '')
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
      const candidates = Array.from(root.querySelectorAll('[role="radio"], input[type="radio"], label, button, div'))
        .filter(isVisible)
      return candidates.some((element) => {
        const checked =
          element.getAttribute('aria-checked') === 'true' ||
          element.matches?.('input[type="radio"]:checked') ||
          Boolean(element.querySelector?.('input[type="radio"]:checked'))
        if (!checked) return false
        const text = normalize(
          element.innerText ||
          element.textContent ||
          element.getAttribute?.('aria-label') ||
          ''
        )
        return labels.some((label) => text === label || text.startsWith(label) || text.includes(label))
      })
    }, { aliases })
    : page.evaluate((payload) => {
      const normalize = (text) => String(text || '')
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
      const candidates = Array.from(document.querySelectorAll('[role="radio"], input[type="radio"], label, button, div'))
        .filter(isVisible)
      return candidates.some((element) => {
        const checked =
          element.getAttribute('aria-checked') === 'true' ||
          element.matches?.('input[type="radio"]:checked') ||
          Boolean(element.querySelector?.('input[type="radio"]:checked'))
        if (!checked) return false
        const text = normalize(
          element.innerText ||
          element.textContent ||
          element.getAttribute?.('aria-label') ||
          ''
        )
        return labels.some((label) => text === label || text.startsWith(label) || text.includes(label))
      })
    }, { aliases })).catch(() => false)

  return Boolean(selected)
}

async function readDropdownValueInSection(page, sectionPattern) {
  const section = await findSectionRoot(page, sectionPattern, 2600).catch(() => null)
  const trigger = await findVisibleLocator(section || page, [
    (ctx) => ctx.getByRole('combobox'),
    (ctx) => ctx.locator('[role="combobox"], [aria-haspopup="listbox"], button, div[role="button"]'),
  ], 1600)

  if (trigger) {
    return String(await trigger.textContent().catch(() => '') || '').trim()
  }

  return ''
}

async function expandSectionIfNeeded(page, sectionPattern) {
  const section = await findSectionRoot(page, sectionPattern, 2200).catch(() => null)
  if (!section) return false

  const clicked = await section.evaluate((root) => {
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
    const toggler = Array.from(root.querySelectorAll('button, [role="button"], div, span'))
      .filter(isVisible)
      .find((element) => {
        const text = normalize(element.innerText || element.textContent)
        return (
          element.getAttribute('aria-expanded') === 'false' ||
          text === 'mostrar mas opciones' ||
          text.startsWith('mostrar mas opciones') ||
          text === 'mostrar más opciones' ||
          text.startsWith('mostrar más opciones')
        )
      })
    if (!toggler) return false
    toggler.click()
    return true
  }).catch(() => false)

  if (clicked) {
    await page.waitForTimeout(600)
  }
  return clicked
}

async function hasEditableDateInputs(root) {
  return await root.evaluate((element) => {
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
    return Array.from(element.querySelectorAll('input'))
      .filter(isVisible)
      .some((input) => {
        if (input.disabled || input.readOnly) return false
        const type = normalize(input.getAttribute('type') || input.type || '')
        const label = normalize(input.getAttribute('aria-label'))
        const placeholder = normalize(input.getAttribute('placeholder'))
        return type === 'date' || label.includes('fecha') || placeholder.includes('fecha')
      }) || normalize(element.textContent).includes('fecha de inicio') || normalize(element.textContent).includes('fecha de finalizacion')
  }).catch(() => false)
}

module.exports = {
  findVisibleLocator,
  findSectionRoot,
  locateDynamicSection,
  isRadioOptionSelectedInLocator,
  clickRadioOptionInLocator,
  readDropdownValueInLocator,
  selectDropdownOptionInLocator,
  fillVisibleInput,
  fillNamedEditorInput,
  clickRadioOptionInSection,
  selectDropdownOptionInSection,
  isRadioOptionSelectedInSection,
  readDropdownValueInSection,
  expandSectionIfNeeded,
  hasEditableDateInputs,
}
