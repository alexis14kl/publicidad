const fs = require('fs')
const path = require('path')
const state = require('../state')
const { ensureAbsoluteUrl } = require('../utils/helpers')
const { getProjectEnv } = require('../utils/env')
const { findVisibleLocator, findSectionRoot, fillVisibleInput, fillNamedEditorInput, locateDynamicSection, selectDropdownOptionInLocator } = require('./ui-primitives')
const { resolveFacebookUiFlowRules, buildDraftLeadFormName, scrollEditorWorkArea, logFacebookUiStep } = require('./ui-campaign')

async function isFacebookAdEditorReady(page) {
  const ready = await findVisibleLocator(page, [
    (ctx) => ctx.getByText(/nombre del anuncio|identidad|configuracion del anuncio|configuración del anuncio|contenido del anuncio|destino|configurar contenido|vista previa|publicar/i),
    (ctx) => ctx.locator('section, div, main, aside').filter({ hasText: /nombre del anuncio|identidad|configuracion del anuncio|configuración del anuncio|contenido del anuncio|destino|configurar contenido|vista previa|publicar/i }),
    (ctx) => ctx.locator('[role="button"], button, a, div').filter({ hasText: /1 anuncio|nuevo anuncio|anuncio de clientes potenciales/i }),
  ], 7000)
  return Boolean(ready)
}

async function getVisibleAdEditorSectionNames(page) {
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
        text === 'nombre del anuncio' ||
        text === 'identidad' ||
        text === 'configuracion del anuncio' ||
        text === 'configuración del anuncio' ||
        text === 'contenido del anuncio' ||
        text === 'texto principal' ||
        text === 'titulo' ||
        text === 'título' ||
        text === 'descripcion' ||
        text === 'descripción' ||
        text === 'llamada a la accion' ||
        text === 'llamada a la acción' ||
        text === 'formulario instantaneo' ||
        text === 'formulario instantáneo' ||
        text === 'destino'
      ) {
        if (!seen.has(text)) {
          seen.add(text)
          interesting.push(title)
        }
      }
    }
    return interesting.slice(0, 16)
  }).catch(() => [])
}

function shouldForceGeneratedAsset(preview) {
  return Boolean(
    preview?.generateImageFromMarketingPrompt &&
    preview?.generatedImageStatus === 'generated' &&
    preview?.imageAsset?.preparedPath
  )
}

function getPreparedAssetPath(preview) {
  return String(preview?.imageAsset?.preparedPath || '').trim()
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function findContentConfigurationModal(page, timeout = 5000) {
  return await findVisibleLocator(page, [
    (ctx) => ctx.locator('[role="dialog"], [aria-modal="true"]').filter({ hasText: /configurar contenido|contenido multimedia|ajustar|texto|mejoras/i }),
    (ctx) => ctx.locator('div').filter({ hasText: /configurar contenido|contenido multimedia|ajustar|texto|mejoras/i }),
  ], timeout)
}

async function findAnyFileInput(...targets) {
  for (const target of targets.filter(Boolean)) {
    try {
      const locator = target.locator('input[type="file"]')
      const count = await locator.count()
      if (count > 0) {
        return locator.last()
      }
    } catch {
      // Continue with the next target.
    }
  }
  return null
}

async function clickUploadTriggerInContentModal(page, modal) {
  const uploadTrigger = await findVisibleLocator(modal, [
    (ctx) => ctx.getByRole('button', { name: /subir|cargar|agregar|anadir|añadir|seleccionar archivo|equipo|computadora|multimedia|imagen|upload/i }),
    (ctx) => ctx.locator('button, [role="button"], label, div').filter({ hasText: /subir|cargar|agregar|anadir|añadir|seleccionar archivo|equipo|computadora|multimedia|imagen|upload/i }),
  ], 1800) || await findVisibleLocator(page, [
    (ctx) => ctx.getByRole('button', { name: /subir|cargar|agregar|anadir|añadir|seleccionar archivo|equipo|computadora|multimedia|imagen|upload/i }),
    (ctx) => ctx.locator('button, [role="button"], label, div').filter({ hasText: /subir|cargar|agregar|anadir|añadir|seleccionar archivo|equipo|computadora|multimedia|imagen|upload/i }),
  ], 1800)

  if (!uploadTrigger) {
    return false
  }

  await uploadTrigger.click({ timeout: 5000, force: true }).catch(() => {})
  await page.waitForTimeout(1000)
  return true
}

async function uploadGeneratedImageInModal(page, modal, preview) {
  const preparedAssetPath = getPreparedAssetPath(preview)
  if (!preparedAssetPath || !fs.existsSync(preparedAssetPath)) {
    throw new Error('No tengo un asset local preparado para subir al modal de Contenido multimedia.')
  }

  let fileInput = await findAnyFileInput(modal, page)
  if (!fileInput) {
    await clickUploadTriggerInContentModal(page, modal)
    fileInput = await findAnyFileInput(modal, page)
  }

  if (!fileInput) {
    throw new Error('No encontre un input de archivo dentro del modal de Contenido multimedia.')
  }

  await fileInput.setInputFiles(preparedAssetPath)
  await page.waitForTimeout(2600)

  const baseName = path.basename(preparedAssetPath).replace(/\.[^.]+$/, '')
  const baseNamePattern = new RegExp(escapeRegex(baseName), 'i')
  const uploadedTile = await findVisibleLocator(modal, [
    (ctx) => ctx.getByText(baseNamePattern),
    (ctx) => ctx.locator('button, [role="button"], label, div').filter({ hasText: baseNamePattern }),
  ], 2200)

  if (uploadedTile) {
    await uploadedTile.click({ timeout: 5000, force: true }).catch(() => {})
    await page.waitForTimeout(900)
  }

  const selected = await modal.evaluate((root, payload) => {
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
    const text = normalize(root.innerText || root.textContent || '')
    if (payload.baseName && text.includes(payload.baseName)) {
      return true
    }
    if (text.includes('1 seleccionado') || text.includes('1 seleccionados') || text.includes('1 selected')) {
      return true
    }
    return Array.from(root.querySelectorAll('[aria-selected="true"], [aria-checked="true"], [data-selected="true"]'))
      .filter(isVisible)
      .length > 0
  }, { baseName: baseName.toLowerCase() }).catch(() => false)

  if (!selected) {
    throw new Error('Subi la imagen generada, pero Meta no la dejo marcada como seleccionada en el modal.')
  }

  return {
    uploaded: true,
    fileName: path.basename(preparedAssetPath),
  }
}

async function getContentSectionMediaSignature(contentSection) {
  return await contentSection.evaluate((element) => {
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
    const imageSources = Array.from(element.querySelectorAll('img'))
      .filter(isVisible)
      .map((img) => String(img.currentSrc || img.src || '').trim())
      .filter(Boolean)
      .slice(0, 12)
    const labels = Array.from(element.querySelectorAll('span, div, button, [role="button"]'))
      .filter(isVisible)
      .map((node) => normalize(node.innerText || node.textContent || node.getAttribute?.('aria-label') || ''))
      .filter(Boolean)
      .slice(0, 18)
    return JSON.stringify({ imageSources, labels })
  }).catch(() => '')
}

async function openPhotoAdContentModal(page, contentSection) {
  const trigger = await findVisibleLocator(contentSection, [
    (ctx) => ctx.getByRole('button', { name: /configurar contenido|editar contenido|editar|agregar multimedia|anadir multimedia|añadir multimedia|imagen|multimedia/i }),
    (ctx) => ctx.locator('button, [role="button"]').filter({ hasText: /configurar contenido|editar contenido|editar|agregar multimedia|anadir multimedia|añadir multimedia|imagen|multimedia/i }),
  ], 2600)
  if (!trigger) {
    throw new Error('No encontre el boton Configurar contenido.')
  }

  await trigger.click({ timeout: 5000, force: true }).catch(() => {})
  await page.waitForTimeout(900)

  let modal = await findContentConfigurationModal(page, 2200)
  if (modal) {
    return modal
  }

  const editMultimediaAction = await findVisibleLocator(page, [
    (ctx) => ctx.getByRole('menuitem', { name: /editar contenido multimedia|contenido multimedia/i }),
    (ctx) => ctx.getByRole('button', { name: /editar contenido multimedia|contenido multimedia/i }),
    (ctx) => ctx.locator('button, [role="button"], [role="menuitem"], div').filter({ hasText: /editar contenido multimedia|contenido multimedia/i }),
  ], 2200)
  if (editMultimediaAction) {
    await editMultimediaAction.click({ timeout: 5000, force: true }).catch(() => {})
    await page.waitForTimeout(1200)
    modal = await findContentConfigurationModal(page, 3200)
    if (modal) {
      return modal
    }
  }

  const photoOption = await findVisibleLocator(page, [
    (ctx) => ctx.getByRole('menuitem', { name: /anuncio con foto/i }),
    (ctx) => ctx.getByRole('option', { name: /anuncio con foto/i }),
    (ctx) => ctx.locator('button, [role="menuitem"], [role="option"], div').filter({ hasText: /anuncio con foto/i }),
  ], 2600)
  if (!photoOption) {
    throw new Error('No encontre la opcion Anuncio con foto.')
  }

  await photoOption.click({ timeout: 5000, force: true }).catch(() => {})
  await page.waitForTimeout(1500)

  modal = await findContentConfigurationModal(page, 5000)
  if (!modal) {
    throw new Error('No se abrio el modal Configurar contenido.')
  }
  return modal
}

async function selectModalPageTab(modal) {
  const pageTab = await findVisibleLocator(modal, [
    (ctx) => ctx.getByRole('tab', { name: /pagina|página/i }),
    (ctx) => ctx.getByRole('button', { name: /pagina|página/i }),
    (ctx) => ctx.locator('button, [role="tab"], [role="button"], div').filter({ hasText: /pagina|página/i }),
  ], 2200)
  if (pageTab) {
    await pageTab.click({ timeout: 5000, force: true }).catch(() => {})
    await modal.page().waitForTimeout(800)
  }
}

async function selectNoyecodeSourceInModal(modal) {
  const sourceTrigger = await findVisibleLocator(modal, [
    (ctx) => ctx.getByRole('combobox'),
    (ctx) => ctx.locator('[role="combobox"], [aria-haspopup="listbox"], button').filter({ hasText: /noyecode|pagina|página/i }),
  ], 2200)
  if (!sourceTrigger) {
    return
  }

  const sourceText = String(await sourceTrigger.textContent().catch(() => '') || '').trim()
  if (/noyecode/i.test(sourceText)) {
    return
  }

  await sourceTrigger.click({ timeout: 5000, force: true }).catch(() => {})
  await modal.page().waitForTimeout(600)

  const option = await findVisibleLocator(modal.page(), [
    (ctx) => ctx.getByRole('option', { name: /noyecode/i }),
    (ctx) => ctx.getByRole('menuitem', { name: /noyecode/i }),
    (ctx) => ctx.locator('[role="option"], [role="menuitem"], li, button, div').filter({ hasText: /noyecode/i }),
  ], 2200)
  if (option) {
    await option.click({ timeout: 5000, force: true }).catch(() => {})
    await modal.page().waitForTimeout(800)
  }
}

async function selectFirstNoyecodeImageInModal(modal, preview = null) {
  const preferredPhotoId = String(preview?.facebookPhotoId || '').trim()
  const preferredPhotoUrl = String(preview?.facebookPhotoUrl || '').trim()
  const preferredPhotoName = String(preview?.facebookPhotoName || '').trim()
  const clicked = await modal.evaluate((root, payload) => {
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
    const containers = Array.from(root.querySelectorAll('div, section')).filter(isVisible)
    const noyecodeContainer =
      containers.find((element) => normalize(element.textContent).includes('noyecode')) ||
      root
    const clickables = Array.from(noyecodeContainer.querySelectorAll('button, [role="button"], label, div'))
      .filter(isVisible)
      .filter((element) => element.querySelector?.('img'))
    const target =
      clickables.find((element) => {
        const img = element.querySelector('img')
        const src = String(img?.src || '')
        const text = normalize(element.innerText || element.textContent)
        return (
          (payload.preferredPhotoName && text.includes(normalize(payload.preferredPhotoName))) ||
          (payload.preferredPhotoId && src.includes(payload.preferredPhotoId)) ||
          (payload.preferredPhotoUrl && src.includes(payload.preferredPhotoUrl))
        )
      }) ||
      clickables[0]
    if (!target) return false
    target.click()
    return true
  }, {
    preferredPhotoId,
    preferredPhotoUrl,
    preferredPhotoName,
  }).catch(() => false)

  if (!clicked) {
    throw new Error('No encontre una imagen seleccionable en la seccion Noyecode del modal.')
  }

  await modal.page().waitForTimeout(1200)
  const selectionConfirmed = await modal.evaluate((root) => {
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
    const selectionText = Array.from(root.querySelectorAll('div, span, p'))
      .filter(isVisible)
      .map((element) => normalize(element.innerText || element.textContent))
      .find((text) => text.includes('1 seleccionado') || text.includes('1 seleccionados') || text.includes('1 selected'))
    if (selectionText) {
      return true
    }
    return Array.from(root.querySelectorAll('[aria-selected="true"], [aria-checked="true"], [data-selected="true"]'))
      .filter(isVisible)
      .length > 0
  }).catch(() => false)

  if (!selectionConfirmed) {
    throw new Error('La imagen elegida no quedo marcada como seleccionada dentro del modal.')
  }
}

async function clickModalPrimaryAction(page, modal, labelPattern) {
  const searchTargets = [modal, page]
  for (const target of searchTargets) {
    const action = await findVisibleLocator(target, [
      (ctx) => ctx.getByRole('button', { name: labelPattern }),
      (ctx) => ctx.locator('button, [role="button"], [type="button"], [type="submit"]').filter({ hasText: labelPattern }),
      (ctx) => ctx.locator('footer button, footer [role="button"], [role="dialog"] button, [role="dialog"] [role="button"]').filter({ hasText: labelPattern }),
    ], 2200)
    if (action) {
      await action.click({ timeout: 5000, force: true }).catch(() => {})
      await page.waitForTimeout(1200)
      return
    }
  }

  const clicked = await page.evaluate((patternSource, patternFlags) => {
    const matcher = new RegExp(patternSource, patternFlags)
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    const isVisible = (element) => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const candidates = Array.from(document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="button"], button, [role="button"]'))
      .filter(isVisible)
      .filter((element) => matcher.test(normalize(element.innerText || element.textContent || element.getAttribute('aria-label') || '')))
    const target = candidates.find((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true') || candidates[0]
    if (!target) return false
    target.click()
    return true
  }, labelPattern.source, labelPattern.flags).catch(() => false)

  if (!clicked) {
    throw new Error(`No encontre el boton ${labelPattern}.`)
  }
  await page.waitForTimeout(1200)
}

async function waitForUserMediaModalAndUpload(page, preview, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs
  let instructionLogged = false

  while (Date.now() < deadline) {
    if (!instructionLogged) {
      await logFacebookUiStep(
        'Abre manualmente el anuncio en la barra izquierda, entra a "Editar contenido multimedia" y deja visible el modal de carga. Cuando aparezca, subire la imagen automaticamente.',
        'warning'
      )
      instructionLogged = true
    }

    const contentSection = await findSectionRoot(page, /contenido del anuncio/i, 1200).catch(() => null)
    const signatureBefore = contentSection ? await getContentSectionMediaSignature(contentSection) : ''
    const modal = await findContentConfigurationModal(page, 1200)
    if (modal) {
      await logFacebookUiStep('Detecte el modal de Contenido multimedia abierto manualmente. Subire la imagen generada ahora.')
      const uploadState = await uploadGeneratedImageInModal(page, modal, preview)
      if (!uploadState?.uploaded) {
        throw new Error('No pude subir la imagen cuando el usuario abrio manualmente el modal de Contenido multimedia.')
      }

      await logFacebookUiStep('Imagen subida. Revisa el resultado y cierra el modal con Siguiente/Listo o como prefieras; verificare el cambio al cerrarlo.')

      let modalClosed = false
      const closeDeadline = Date.now() + 300000
      while (Date.now() < closeDeadline) {
        const stillOpen = await findContentConfigurationModal(page, 800)
        if (!stillOpen) {
          modalClosed = true
          break
        }
        await page.waitForTimeout(1200)
      }

      if (!modalClosed) {
        throw new Error('El modal de Contenido multimedia sigue abierto. Necesito que el usuario lo cierre para verificar el resultado final.')
      }

      await page.waitForTimeout(1600)
      const updatedSection = await findSectionRoot(page, /contenido del anuncio/i, 2200).catch(() => null)
      if (!updatedSection) {
        return { configured: true, assisted: true }
      }

      const stillPending = await updatedSection.evaluate((element) => {
        const normalize = (value) => String(value || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase()
        return normalize(element.textContent).includes('especifica una imagen')
      }).catch(() => true)
      const signatureAfter = await getContentSectionMediaSignature(updatedSection)
      const mediaChanged = Boolean(signatureAfter && signatureBefore !== signatureAfter)

      return {
        configured: !stillPending || mediaChanged,
        assisted: true,
      }
    }

    await page.waitForTimeout(1500)
  }

  return {
    configured: false,
    assisted: true,
  }
}

async function completePhotoAdContentModalFlow(page, preview) {
  const contentSection = await findSectionRoot(page, /contenido del anuncio/i, 2600).catch(() => null)
  if (!contentSection) {
    return { visible: false, configured: false, textConfigured: false, ctaConfigured: false }
  }
  const shouldReplaceWithGeneratedAsset = shouldForceGeneratedAsset(preview)

  const pendingImage = await contentSection.evaluate((element) => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    return normalize(element.textContent).includes('especifica una imagen')
  }).catch(() => false)

  if (!pendingImage && !shouldReplaceWithGeneratedAsset) {
    return { visible: true, configured: true, textConfigured: false, ctaConfigured: false }
  }

  const signatureBefore = await getContentSectionMediaSignature(contentSection)
  const modal = await openPhotoAdContentModal(page, contentSection)
  let uploadedGeneratedAsset = false
  if (shouldReplaceWithGeneratedAsset) {
    const uploadState = await uploadGeneratedImageInModal(page, modal, preview)
    uploadedGeneratedAsset = Boolean(uploadState?.uploaded)
  } else {
    await selectModalPageTab(modal)
    await selectNoyecodeSourceInModal(modal)
    await selectFirstNoyecodeImageInModal(modal, preview)
  }
  await clickModalPrimaryAction(page, modal, /siguiente|next/i)

  let textStepReady = await findVisibleLocator(page, [
    (ctx) => ctx.locator('[role="dialog"], [aria-modal="true"]').filter({ hasText: /texto principal|llamada a la accion|llamada a la acción/i }),
    (ctx) => ctx.locator('div').filter({ hasText: /texto principal|llamada a la accion|llamada a la acción/i }),
  ], 5000)
  if (!textStepReady) {
    const textNav = await findVisibleLocator(page, [
      (ctx) => ctx.getByRole('button', { name: /texto/i }),
      (ctx) => ctx.getByRole('tab', { name: /texto/i }),
      (ctx) => ctx.locator('button, [role="button"], [role="tab"], div').filter({ hasText: /^texto$/i }),
    ], 2200)
    if (textNav) {
      await textNav.click({ timeout: 5000, force: true }).catch(() => {})
      await page.waitForTimeout(1200)
      textStepReady = await findVisibleLocator(page, [
        (ctx) => ctx.locator('[role="dialog"], [aria-modal="true"]').filter({ hasText: /texto principal|llamada a la accion|llamada a la acción/i }),
        (ctx) => ctx.locator('div').filter({ hasText: /texto principal|llamada a la accion|llamada a la acción/i }),
      ], 3500)
    }
  }
  if (!textStepReady) {
    throw new Error('No aparecio el paso Texto del modal Configurar contenido.')
  }

  const adsAnalyst = preview?.orchestrator?.adsAnalyst || {}
  const primaryText = String(adsAnalyst?.copy || '').trim()
  const ctaLabel = String(adsAnalyst?.cta || '').trim()
  let textConfigured = false
  let ctaConfigured = false

  const textarea = await findVisibleLocator(textStepReady, [
    (ctx) => ctx.getByLabel(/texto principal/i),
    (ctx) => ctx.locator('textarea'),
  ], 2600)
  if (!textarea) {
    throw new Error('No encontre el campo Texto principal dentro del modal.')
  }
  await fillVisibleInput(textarea, primaryText)
  textConfigured = true

  if (ctaLabel) {
    const ctaTrigger = await findVisibleLocator(textStepReady, [
      (ctx) => ctx.getByRole('combobox'),
      (ctx) => ctx.locator('[role="combobox"], [aria-haspopup="listbox"], button'),
    ], 2200)
    if (ctaTrigger) {
      await ctaTrigger.click({ timeout: 5000, force: true }).catch(() => {})
      await page.waitForTimeout(500)
      const ctaOption = await findVisibleLocator(page, [
        (ctx) => ctx.getByRole('option', { name: new RegExp(ctaLabel, 'i') }),
        (ctx) => ctx.getByRole('menuitem', { name: new RegExp(ctaLabel, 'i') }),
        (ctx) => ctx.locator('[role="option"], [role="menuitem"], li, button, div').filter({ hasText: new RegExp(ctaLabel, 'i') }),
      ], 2200)
      if (ctaOption) {
        await ctaOption.click({ timeout: 5000, force: true }).catch(() => {})
        ctaConfigured = true
      }
    }
  }

  await clickModalPrimaryAction(page, textStepReady, /siguiente|next/i)
  let improvementsStepReady = await findVisibleLocator(page, [
    (ctx) => ctx.locator('[role="dialog"], [aria-modal="true"]').filter({ hasText: /mejoras|translation|traduccion|traducción/i }),
    (ctx) => ctx.locator('div').filter({ hasText: /mejoras|translation|traduccion|traducción/i }),
  ], 5000)
  if (!improvementsStepReady) {
    const improvementsNav = await findVisibleLocator(page, [
      (ctx) => ctx.getByRole('button', { name: /mejoras/i }),
      (ctx) => ctx.getByRole('tab', { name: /mejoras/i }),
      (ctx) => ctx.locator('button, [role="button"], [role="tab"], div').filter({ hasText: /mejoras/i }),
    ], 2200)
    if (improvementsNav) {
      await improvementsNav.click({ timeout: 5000, force: true }).catch(() => {})
      await page.waitForTimeout(1200)
      improvementsStepReady = await findVisibleLocator(page, [
        (ctx) => ctx.locator('[role="dialog"], [aria-modal="true"]').filter({ hasText: /mejoras|translation|traduccion|traducción/i }),
        (ctx) => ctx.locator('div').filter({ hasText: /mejoras|translation|traduccion|traducción/i }),
      ], 3500)
    }
  }
  if (!improvementsStepReady) {
    throw new Error('No aparecio el paso Mejoras del modal Configurar contenido.')
  }

  await clickModalPrimaryAction(page, improvementsStepReady, /listo|done|hecho|finalizar|finish/i)
  await page.waitForTimeout(1600)

  const stillPending = await contentSection.evaluate((element) => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    return normalize(element.textContent).includes('especifica una imagen')
  }).catch(() => true)
  const signatureAfter = await getContentSectionMediaSignature(contentSection)
  const mediaChanged = !shouldReplaceWithGeneratedAsset || Boolean(signatureAfter && signatureBefore !== signatureAfter)

  return {
    visible: true,
    configured: !stillPending && (!shouldReplaceWithGeneratedAsset || (uploadedGeneratedAsset && mediaChanged)),
    textConfigured,
    ctaConfigured,
  }
}

async function removeExistingAdMedia(contentSection, page) {
  const deleteButton = await findVisibleLocator(contentSection, [
    (ctx) => ctx.getByRole('button', { name: /eliminar|borrar|quitar|remove|delete/i }),
    (ctx) => ctx.locator('button, [role="button"]').filter({ hasText: /eliminar|borrar|quitar|remove|delete/i }),
    (ctx) => ctx.locator('button[aria-label*="eliminar" i], button[aria-label*="borrar" i], button[aria-label*="remove" i], button[aria-label*="delete" i]'),
  ], 1800)

  if (!deleteButton) {
    return false
  }

  await deleteButton.click({ timeout: 5000, force: true }).catch(() => {})
  await page.waitForTimeout(900)

  const confirmDelete = await findVisibleLocator(page, [
    (ctx) => ctx.getByRole('button', { name: /eliminar|borrar|quitar|remove|delete|aceptar|confirmar/i }),
    (ctx) => ctx.locator('button, [role="button"]').filter({ hasText: /eliminar|borrar|quitar|remove|delete|aceptar|confirmar/i }),
  ], 1800)

  if (confirmDelete) {
    await confirmDelete.click({ timeout: 5000, force: true }).catch(() => {})
    await page.waitForTimeout(1200)
  }

  return true
}

async function configureAdDestinationField(page, destinationUrl) {
  const destinationSection = await locateDynamicSection(page, {
    labels: ['Destino', 'Sitio web', 'Website'],
    controlType: 'input',
  }, 3200).catch(() => null)

  if (!destinationSection) {
    throw new Error('No encontre la seccion de destino del anuncio.')
  }

  const field = await findVisibleLocator(destinationSection, [
    (ctx) => ctx.locator('input:not([type="checkbox"]):not([type="radio"])[aria-label*="sitio web" i]'),
    (ctx) => ctx.locator('input:not([type="checkbox"]):not([type="radio"])[placeholder*="sitio web" i]'),
    (ctx) => ctx.locator('input:not([type="checkbox"]):not([type="radio"])[aria-label*="website" i]'),
    (ctx) => ctx.locator('input:not([type="checkbox"]):not([type="radio"])[placeholder*="website" i]'),
    (ctx) => ctx.locator('input:not([type="checkbox"]):not([type="radio"])[aria-label*="url" i]'),
    (ctx) => ctx.locator('input:not([type="checkbox"]):not([type="radio"])[placeholder*="url" i]'),
  ], 2600)

  if (!field) {
    throw new Error('No encontre el campo de destino del sitio web.')
  }

  await fillVisibleInput(field, destinationUrl)
}

async function ensureAdContentImageConfigured(page, preview) {
  const contentSection = await findSectionRoot(page, /contenido del anuncio/i, 2600).catch(() => null)
  if (!contentSection) {
    return { visible: false, configured: false, attempted: false }
  }
  const shouldForceReplaceAsset = shouldForceGeneratedAsset(preview)

  const hasPendingImage = await contentSection.evaluate((element) => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    return normalize(element.textContent).includes('especifica una imagen')
  }).catch(() => false)

  if (!hasPendingImage && !shouldForceReplaceAsset) {
    return { visible: true, configured: true, attempted: false }
  }

  const preparedAssetPath = getPreparedAssetPath(preview)
  if (!preparedAssetPath || !fs.existsSync(preparedAssetPath)) {
    throw new Error('No tengo un asset local preparado para cargar en Contenido del anuncio.')
  }

  const signatureBefore = await getContentSectionMediaSignature(contentSection)
  let attempted = false
  const openButton = await findVisibleLocator(contentSection, [
    (ctx) => ctx.getByRole('button', { name: /configurar contenido|editar contenido|agregar multimedia|añadir multimedia|agregar imagen|subir imagen|seleccionar imagen/i }),
    (ctx) => ctx.getByRole('button', { name: /editar|configurar|multimedia|imagen|upload/i }),
    (ctx) => ctx.locator('button, [role="button"]').filter({ hasText: /configurar contenido|editar contenido|agregar multimedia|añadir multimedia|agregar imagen|subir imagen|seleccionar imagen|editar|configurar|multimedia|imagen|upload/i }),
  ], 2600)

  if (openButton) {
    await openButton.click({ timeout: 5000, force: true }).catch(() => {})
    attempted = true
    await page.waitForTimeout(1200)
  }

  let fileInput = await findAnyFileInput(page, contentSection)

  if (!fileInput && shouldForceReplaceAsset) {
    const removed = await removeExistingAdMedia(contentSection, page)
    if (removed) {
      attempted = true
      await page.waitForTimeout(1200)
      fileInput = await findAnyFileInput(page, contentSection)
    }
  }

  if (!fileInput) {
    const mediaButton = await findVisibleLocator(page, [
      (ctx) => ctx.getByRole('button', { name: /agregar multimedia|añadir multimedia|agregar imagen|subir imagen|seleccionar imagen|upload/i }),
      (ctx) => ctx.getByRole('button', { name: /reemplazar|editar|multimedia|imagen/i }),
      (ctx) => ctx.locator('button, [role="button"]').filter({ hasText: /agregar multimedia|añadir multimedia|agregar imagen|subir imagen|seleccionar imagen|upload|reemplazar|editar|multimedia|imagen/i }),
    ], 2200)
    if (mediaButton) {
      await mediaButton.click({ timeout: 5000, force: true }).catch(() => {})
      attempted = true
      await page.waitForTimeout(1200)
      fileInput = await findAnyFileInput(page, contentSection)
    }
  }

  if (!fileInput) {
    throw new Error('No encontre un selector de archivo para cargar la imagen del anuncio.')
  }

  await fileInput.setInputFiles(preparedAssetPath)
  attempted = true
  await page.waitForTimeout(2200)

  const stillPending = await contentSection.evaluate((element) => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    return normalize(element.textContent).includes('especifica una imagen')
  }).catch(() => true)
  const signatureAfter = await getContentSectionMediaSignature(contentSection)
  const mediaChanged = !shouldForceReplaceAsset || Boolean(signatureAfter && signatureBefore !== signatureAfter)

  return {
    visible: true,
    configured: !stillPending && mediaChanged,
    attempted,
  }
}

async function tryFacebookUiOpenAdFromSidebar(page, preview) {
  const uiRules = resolveFacebookUiFlowRules(preview, preview?.orchestrator || null)
  const adName = String(uiRules.adName || '').trim()
  const adNeedle = adName.slice(0, 32).trim()
  const uiRulesCampaignName = String(uiRules.campaignName || '').trim()
  const uiRulesAdsetName = String(uiRules.adsetName || '').trim()

  const sidebarTree = await page.evaluate((payload) => {
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
    const searchInput = Array.from(document.querySelectorAll('input, textarea'))
      .filter(isVisible)
      .find((element) => /buscar|search/i.test(String(element.getAttribute('placeholder') || element.getAttribute('aria-label') || '')))
    const searchRect = searchInput?.getBoundingClientRect?.() || null

    const campaignNeedle = normalize(payload.campaignName)
    const adsetNeedle = normalize(payload.adsetName)
    const adNeedle = normalize(payload.adNeedle)
    const hasCampaignText = (text) => (campaignNeedle && text.includes(campaignNeedle)) || text.startsWith('lead gen ')
    const hasAdsetText = (text) => (adsetNeedle && text.includes(adsetNeedle)) || text.startsWith('conjunto ')
    const hasAdText = (text) => (adNeedle && text.includes(adNeedle)) || text.startsWith('ad ')

    const rootCandidates = Array.from(document.querySelectorAll('aside, nav, section, div'))
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const text = normalize(element.innerText || element.textContent || '')
        const score =
          (hasCampaignText(text) ? 4 : 0) +
          (hasAdsetText(text) ? 3 : 0) +
          (hasAdText(text) ? 3 : 0)
        return { element, rect, text, score }
      })
      .filter((item) =>
        item.rect.left >= 70 &&
        item.rect.right <= 430 &&
        item.rect.width >= 220 &&
        item.rect.height >= 120 &&
        item.rect.top >= (searchRect ? searchRect.bottom - 20 : 60) &&
        item.score >= 7
      )
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return a.rect.top - b.rect.top
      })

    const treeRoot = rootCandidates[0]?.element || null
    if (!treeRoot) {
      return null
    }

    const structuredRows = Array.from(treeRoot.querySelectorAll('[id^="ads_campaign_structure_item_"][role="rowheader"]'))
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const text = normalize(element.innerText || element.textContent || element.getAttribute?.('aria-label') || '')
        const objectType = normalize(element.getAttribute('data-objecttype') || '')
        return { rect, text, objectType }
      })
      .filter((item) =>
        item.rect.left >= 70 &&
        item.rect.right <= 430 &&
        item.rect.height >= 20 &&
        item.rect.height <= 80 &&
        item.text &&
        !/ctrl\+|pressable|editar|revisar|publicar|buscar|historial/.test(item.text)
      )
      .sort((a, b) => (a.rect.top - b.rect.top) || (a.rect.left - b.rect.left))

    const rows = structuredRows.length > 0
      ? structuredRows
      : Array.from(treeRoot.querySelectorAll('button, a, [role="button"], [role="treeitem"], [role="row"], div, span'))
        .filter(isVisible)
        .map((element) => {
          const clickable = element.closest?.('button, a, [role="button"], [role="treeitem"], [role="row"]') || element
          const rect = clickable.getBoundingClientRect()
          const text = normalize(clickable.innerText || clickable.textContent || clickable.getAttribute?.('aria-label') || '')
          return { rect, text, objectType: '' }
        })
        .filter((item) =>
          item.rect.left >= 70 &&
          item.rect.right <= 430 &&
          item.rect.height >= 20 &&
          item.rect.height <= 80 &&
          item.text &&
          !/ctrl\+|pressable|editar|revisar|publicar|buscar|historial/.test(item.text)
        )
        .sort((a, b) => (a.rect.top - b.rect.top) || (a.rect.left - b.rect.left))

    const uniqueRows = []
    const seen = new Set()
    for (const row of rows) {
      const key = `${row.text}|${Math.round(row.rect.top)}`
      if (seen.has(key)) continue
      seen.add(key)
      uniqueRows.push({
        text: row.text,
        objectType: row.objectType,
        top: row.rect.top,
        left: row.rect.left,
        width: row.rect.width,
        height: row.rect.height,
      })
    }

    const campaignRow =
      uniqueRows.find((item) => item.objectType === 'campaign') ||
      uniqueRows.find((item) => hasCampaignText(item.text))
    const adsetRow =
      uniqueRows.find((item) => item.objectType === 'adset') ||
      uniqueRows.find((item) => hasAdsetText(item.text))
    const adRow =
      uniqueRows.find((item) => item.objectType === 'adgroup') ||
      uniqueRows.find((item) => hasAdText(item.text))

    return {
      campaignRow,
      adsetRow,
      adRow,
    }
  }, {
    adNeedle,
    campaignName: uiRulesCampaignName,
    adsetName: uiRulesAdsetName,
  }).catch(() => null)

  const rowsToOpen = [
    sidebarTree?.campaignRow,
    sidebarTree?.adsetRow,
    sidebarTree?.adRow,
  ].filter(Boolean)

  if (rowsToOpen.length < 3) {
    await logFacebookUiStep('No pude identificar las tres filas del arbol de campana (Campaña, Conjunto y Ad) dentro de la barra lateral correcta.', 'warning')
    return false
  }

  let lastItemText = ''
  for (const item of rowsToOpen) {
    if (!item) continue
    lastItemText = item.text
    const clickX = Math.max(20, Math.round(item.left + Math.min(item.width / 2, 180)))
    const clickY = Math.max(20, Math.round(item.top + (item.height / 2)))
    await page.mouse.click(clickX, clickY, { delay: 120 }).catch(() => {})
    if (item === rowsToOpen[2]) {
      await page.mouse.click(clickX, clickY, { delay: 120 }).catch(() => {})
    }
    await page.waitForTimeout(1200)
    await logFacebookUiStep(`Elemento lateral abierto para llegar al anuncio: ${item.text}.`)
  }

  const selectedAdConfirmed = await page.evaluate((payload) => {
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
    const selectedNeedles = [
      normalize(payload.adNeedle),
      normalize(payload.lastItemText),
      'ad ',
    ].filter(Boolean)
    const leftItems = Array.from(document.querySelectorAll('[id^="ads_campaign_structure_item_"][role="rowheader"], button, a, [role="button"], [role="treeitem"], [role="row"], div, span'))
      .filter(isVisible)
      .map((element) => {
        const host = element.matches?.('[id^="ads_campaign_structure_item_"][role="rowheader"]')
          ? element
          : (element.closest?.('button, a, [role="button"], [role="treeitem"], [role="row"]') || element)
        const rect = host.getBoundingClientRect()
        const style = window.getComputedStyle(host)
        const text = normalize(host.innerText || host.textContent || host.getAttribute?.('aria-label') || '')
        const objectType = normalize(host.getAttribute('data-objecttype') || '')
        return {
          text,
          objectType,
          selected:
            host.getAttribute('aria-selected') === 'true' ||
            host.getAttribute('aria-current') === 'true' ||
            host.getAttribute('data-selected') === 'true' ||
            host.getAttribute('tabindex') === '0' ||
            style.backgroundColor.includes('rgb(225') ||
            style.backgroundColor.includes('rgb(227') ||
            host.className?.toString?.().toLowerCase?.().includes('selected'),
          left: rect.left,
          right: rect.right,
        }
      })
      .filter((item) => item.left >= 70 && item.right <= 430 && item.text && !/ctrl\+|pressable|editar|revisar|publicar|buscar|historial/.test(item.text))
    return leftItems.some((item) =>
      item.selected &&
      (item.objectType === 'adgroup' || selectedNeedles.some((needle) => needle && item.text.includes(needle)))
    )
  }, {
    adNeedle,
    lastItemText,
  }).catch(() => false)

  if (!selectedAdConfirmed) {
    await logFacebookUiStep('No pude confirmar que el nodo Ad quedara seleccionado en la barra lateral izquierda.', 'warning')
    return false
  }

  const editorOrContent = await findVisibleLocator(page, [
    (ctx) => ctx.locator('section, div').filter({ hasText: /contenido del anuncio|texto principal|titulo|título|nombre del anuncio/i }),
    (ctx) => ctx.getByText(/contenido del anuncio|nombre del anuncio/i),
  ], 4200)

  if (!editorOrContent) {
    await logFacebookUiStep('No pude abrir correctamente el nivel de anuncio desde el arbol izquierdo.', 'warning')
    return false
  }

  return true
}

async function tryFacebookUiReachAdEditor(preview, options = {}) {
  const facebookVisualPage = state.facebookVisualPage
  const onlyReplaceImage = Boolean(options?.onlyReplaceImage)
  if (!facebookVisualPage || facebookVisualPage.isClosed()) {
    return {
      reachedEditor: false,
      nameFilled: false,
      imageConfigured: false,
      destinationConfigured: false,
      primaryTextConfigured: false,
      headlineConfigured: false,
      descriptionConfigured: false,
      ctaConfigured: false,
      leadFormConfigured: false,
      visibleSections: [],
      canFinalize: false,
    }
  }

  const page = facebookVisualPage
  await page.bringToFront()
  await page.waitForTimeout(1600)

  let reachedEditor = false
  let sidebarOpened = false
  const initialReady = await isFacebookAdEditorReady(page)
  if (onlyReplaceImage || !initialReady) {
    sidebarOpened = await tryFacebookUiOpenAdFromSidebar(page, preview)
    if (onlyReplaceImage && !sidebarOpened) {
      const assistedUpload = await waitForUserMediaModalAndUpload(page, preview)
      if (!assistedUpload.configured) {
        await logFacebookUiStep('Detengo la automatizacion porque ni el bot ni el usuario lograron dejar la imagen confirmada en Contenido multimedia.', 'warning')
        return {
          reachedEditor: false,
          nameFilled: false,
          imageConfigured: false,
          destinationConfigured: false,
          primaryTextConfigured: false,
          headlineConfigured: false,
          descriptionConfigured: false,
          ctaConfigured: false,
          leadFormConfigured: false,
          visibleSections: [],
          canFinalize: false,
        }
      }

      await logFacebookUiStep('La imagen quedo cargada mediante apoyo manual del usuario y ya puedo dar por finalizado este tramo.')
      return {
        reachedEditor: true,
        nameFilled: true,
        imageConfigured: true,
        destinationConfigured: true,
        primaryTextConfigured: true,
        headlineConfigured: true,
        descriptionConfigured: true,
        ctaConfigured: true,
        leadFormConfigured: true,
        visibleSections: ['Contenido del anuncio'],
        canFinalize: true,
      }
    }
  }

  for (let attempt = 0; attempt < 7; attempt += 1) {
    reachedEditor = await isFacebookAdEditorReady(page)
    if (reachedEditor) {
      break
    }
    await scrollEditorWorkArea(page, attempt === 0 ? 300 : 700)
    await page.waitForTimeout(2200 + (attempt * 900))
  }

  if (!reachedEditor) {
    await logFacebookUiStep('No llegue todavia al apartado Nuevo anuncio de clientes potenciales.', 'warning')
    return {
      reachedEditor: false,
      nameFilled: false,
      imageConfigured: false,
      destinationConfigured: false,
      primaryTextConfigured: false,
      headlineConfigured: false,
      descriptionConfigured: false,
      ctaConfigured: false,
      leadFormConfigured: false,
      visibleSections: [],
      canFinalize: false,
    }
  }

  await logFacebookUiStep('Ya estoy en el apartado Nuevo anuncio de clientes potenciales.')
  const visibleSections = await getVisibleAdEditorSectionNames(page)
  if (visibleSections.length > 0) {
    await logFacebookUiStep(`Apartados visibles del anuncio: ${visibleSections.join(' | ')}.`)
  }
  const destinationVisible = visibleSections.some((item) => /destino/i.test(String(item)))
  const ctaVisible = visibleSections.some((item) => /llamada a la accion|llamada a la acción/i.test(String(item)))
  const formVisible = visibleSections.some((item) => /formulario instantaneo|formulario instantáneo/i.test(String(item)))

  let nameFilled = false
  let imageConfigured = false
  let destinationConfigured = false
  let primaryTextConfigured = false
  let headlineConfigured = false
  let descriptionConfigured = false
  let ctaConfigured = false
  let leadFormConfigured = false
  const uiRules = resolveFacebookUiFlowRules(preview, preview?.orchestrator || null)
  const adsAnalyst = preview?.orchestrator?.adsAnalyst || {}
  const primaryText = String(adsAnalyst?.copy || '').trim()
  const headline = String(adsAnalyst?.hook || '').trim()
  const description = String(adsAnalyst?.strategicAngle || '').trim()
  const ctaLabel = String(adsAnalyst?.cta || '').trim()
  const destinationUrl = ensureAbsoluteUrl(preview?.url || getProjectEnv().BUSINESS_WEBSITE || 'https://noyecode.com')
  const selectedLeadgenFormId = String(preview?.selectedLeadgenFormId || '').trim()
  const selectedLeadgenFormName = String(preview?.selectedLeadgenFormName || '').trim()
  const expectedLeadFormName = String(
    preview?.orchestrator?.execution?.leadFormName ||
    buildDraftLeadFormName(preview, preview?.orchestrator || null)
  ).trim()
  if (onlyReplaceImage) {
    nameFilled = true
    destinationConfigured = true
    primaryTextConfigured = true
    headlineConfigured = true
    descriptionConfigured = true
    ctaConfigured = true
    leadFormConfigured = true
    await logFacebookUiStep('Modo reapertura n8n: solo reemplazare la imagen desde Contenido multimedia y no tocare el resto de campos del anuncio.')
  } else {
    try {
      await fillNamedEditorInput(page, {
        labelPattern: /nombre del anuncio|ad name/i,
        sectionPattern: /nombre del anuncio|ad name/i,
        labelTexts: ['Nombre del anuncio', 'Ad name'],
        sectionTexts: ['Nombre del anuncio', 'Ad name'],
        value: uiRules.adName,
        allowFirstVisibleFallback: false,
        selectors: [
          'input[aria-label*="anuncio" i]',
          'input[placeholder*="anuncio" i]',
          'input[aria-label*="ad name" i]',
          'input[placeholder*="ad name" i]',
        ],
        errorMessage: 'No encontre el campo de nombre del anuncio.',
      })
      await logFacebookUiStep(`Nombre del anuncio corregido en la UI: ${uiRules.adName}.`)
      nameFilled = true
    } catch (error) {
      await logFacebookUiStep(`No pude corregir el nombre del anuncio: ${error.message || error}`, 'warning')
    }
  }

  if (!onlyReplaceImage) {
    try {
      if (!destinationVisible) {
        throw new Error('La seccion Destino no esta visible en este paso.')
      }
      await configureAdDestinationField(page, destinationUrl)
      await logFacebookUiStep(`Destino del anuncio ajustado a ${destinationUrl}.`)
      destinationConfigured = true
    } catch (error) {
      if (destinationVisible) {
        await logFacebookUiStep(`No pude configurar el destino del anuncio: ${error.message || error}`, 'warning')
      }
    }
  }

  try {
    const modalState = await completePhotoAdContentModalFlow(page, preview)
    if (modalState.visible && modalState.configured) {
      await logFacebookUiStep(
        shouldForceGeneratedAsset(preview)
          ? 'Contenido del anuncio alineado con la imagen generada para esta campaña y el modal Configurar contenido quedo completado.'
          : 'Contenido del anuncio alineado con una imagen de Noyecode y el modal Configurar contenido quedo completado.'
      )
      imageConfigured = true
      if (modalState.textConfigured) {
        primaryTextConfigured = true
      }
      if (modalState.ctaConfigured) {
        ctaConfigured = true
      }
    } else if (!modalState.visible) {
      imageConfigured = true
    } else {
      await logFacebookUiStep('Todavia falta una imagen valida en Contenido del anuncio.', 'warning')
      if (shouldForceGeneratedAsset(preview)) {
        await logFacebookUiStep('Detengo la automatizacion del anuncio porque no pude verificar el cambio de la imagen generada en Contenido multimedia.', 'warning')
        return {
          reachedEditor: true,
          nameFilled,
          imageConfigured: false,
          destinationConfigured,
          primaryTextConfigured,
          headlineConfigured,
          descriptionConfigured,
          ctaConfigured,
          leadFormConfigured,
          visibleSections,
          canFinalize: false,
        }
      }
    }
  } catch (error) {
    await logFacebookUiStep(`No pude completar el modal de Contenido del anuncio: ${error.message || error}`, 'warning')
    try {
      const imageState = await ensureAdContentImageConfigured(page, preview)
      if (imageState.visible && imageState.configured) {
        await logFacebookUiStep('Contenido del anuncio alineado con la imagen seleccionada para la campaña.')
        imageConfigured = true
      } else if (!imageState.visible) {
        imageConfigured = true
      } else {
        await logFacebookUiStep('Todavia falta una imagen valida en Contenido del anuncio.', 'warning')
        if (shouldForceGeneratedAsset(preview)) {
          await logFacebookUiStep('Detengo la automatizacion del anuncio porque no pude verificar el cambio de la imagen generada en Contenido multimedia.', 'warning')
          return {
            reachedEditor: true,
            nameFilled,
            imageConfigured: false,
            destinationConfigured,
            primaryTextConfigured,
            headlineConfigured,
            descriptionConfigured,
            ctaConfigured,
            leadFormConfigured,
            visibleSections,
            canFinalize: false,
          }
        }
      }
    } catch (fallbackError) {
      await logFacebookUiStep(`No pude configurar la imagen del anuncio: ${fallbackError.message || fallbackError}`, 'warning')
      if (shouldForceGeneratedAsset(preview)) {
        await logFacebookUiStep('Detengo la automatizacion del anuncio porque la imagen generada no logro subirse ni reemplazar el multimedia actual.', 'warning')
        return {
          reachedEditor: true,
          nameFilled,
          imageConfigured: false,
          destinationConfigured,
          primaryTextConfigured,
          headlineConfigured,
          descriptionConfigured,
          ctaConfigured,
          leadFormConfigured,
          visibleSections,
          canFinalize: false,
        }
      }
    }
  }

  if (!onlyReplaceImage && destinationVisible && !destinationConfigured) {
    try {
      await configureAdDestinationField(page, destinationUrl)
      await logFacebookUiStep(`Destino del anuncio ajustado a ${destinationUrl}.`)
      destinationConfigured = true
    } catch (error) {
      await logFacebookUiStep(`No pude configurar el destino del anuncio despues de seleccionar el contenido: ${error.message || error}`, 'warning')
    }
  }

  if (!onlyReplaceImage) {
    try {
      if (primaryTextConfigured) {
        throw new Error('El texto principal ya quedo configurado desde el modal.')
      }
      if (!primaryText) {
        throw new Error('No tengo copy del ads-analyst para el texto principal.')
      }
      await fillNamedEditorInput(page, {
        labelPattern: /texto principal|primary text|texto del anuncio|ad text/i,
        sectionPattern: /contenido del anuncio|texto principal|primary text/i,
        labelTexts: ['Texto principal', 'Primary text', 'Texto del anuncio'],
        sectionTexts: ['Contenido del anuncio', 'Texto principal', 'Primary text'],
        value: primaryText,
        allowFirstVisibleFallback: false,
        selectors: [
          'textarea[aria-label*="texto principal" i]',
          'textarea[placeholder*="texto principal" i]',
          'textarea[aria-label*="primary text" i]',
          'textarea[placeholder*="primary text" i]',
          'textarea',
        ],
        errorMessage: 'No encontre el campo de texto principal del anuncio.',
      })
      await logFacebookUiStep('Texto principal del anuncio rellenado con el copy del ads-analyst.')
      primaryTextConfigured = true
    } catch (error) {
      if (!primaryTextConfigured) {
        await logFacebookUiStep(`No pude rellenar el texto principal del anuncio: ${error.message || error}`, 'warning')
      }
    }
  }

  if (!onlyReplaceImage) {
    try {
      if (!headline) {
        throw new Error('No tengo headline del ads-analyst para el titulo.')
      }
      await fillNamedEditorInput(page, {
        labelPattern: /titulo|título|headline/i,
        sectionPattern: /contenido del anuncio|titulo|título|headline/i,
        labelTexts: ['Título', 'Titulo', 'Headline'],
        sectionTexts: ['Contenido del anuncio', 'Título', 'Titulo', 'Headline'],
        value: headline,
        useLabelLookup: false,
        allowFirstVisibleFallback: false,
        selectors: [
          'input:not([type="checkbox"]):not([type="radio"])[aria-label*="título" i]',
          'input:not([type="checkbox"]):not([type="radio"])[placeholder*="título" i]',
          'input:not([type="checkbox"]):not([type="radio"])[aria-label*="titulo" i]',
          'input:not([type="checkbox"]):not([type="radio"])[placeholder*="titulo" i]',
          'input:not([type="checkbox"]):not([type="radio"])[aria-label*="headline" i]',
          'input:not([type="checkbox"]):not([type="radio"])[placeholder*="headline" i]',
        ],
        errorMessage: 'No encontre el campo de titulo del anuncio.',
      })
      await logFacebookUiStep('Titulo del anuncio rellenado con el hook del ads-analyst.')
      headlineConfigured = true
    } catch (error) {
      await logFacebookUiStep(`No pude rellenar el titulo del anuncio: ${error.message || error}`, 'warning')
    }
  }

  if (!onlyReplaceImage) {
    try {
      if (!description) {
        throw new Error('No tengo descripcion del ads-analyst para el anuncio.')
      }
      await fillNamedEditorInput(page, {
        labelPattern: /descripcion|descripción|description/i,
        sectionPattern: /contenido del anuncio|descripcion|descripción|description/i,
        labelTexts: ['Descripción', 'Descripcion', 'Description'],
        sectionTexts: ['Contenido del anuncio', 'Descripción', 'Descripcion', 'Description'],
        value: description,
        useLabelLookup: false,
        allowFirstVisibleFallback: false,
        selectors: [
          'input:not([type="checkbox"]):not([type="radio"])[aria-label*="descripción" i]',
          'input:not([type="checkbox"]):not([type="radio"])[placeholder*="descripción" i]',
          'input:not([type="checkbox"]):not([type="radio"])[aria-label*="descripcion" i]',
          'input:not([type="checkbox"]):not([type="radio"])[placeholder*="descripcion" i]',
          'input:not([type="checkbox"]):not([type="radio"])[aria-label*="description" i]',
          'input:not([type="checkbox"]):not([type="radio"])[placeholder*="description" i]',
        ],
        errorMessage: 'No encontre el campo de descripcion del anuncio.',
      })
      await logFacebookUiStep('Descripcion del anuncio rellenada con el angulo estrategico.')
      descriptionConfigured = true
    } catch (error) {
      await logFacebookUiStep(`No pude rellenar la descripcion del anuncio: ${error.message || error}`, 'warning')
    }
  }

  if (!onlyReplaceImage) {
    try {
      if (ctaConfigured) {
        throw new Error('El CTA ya quedo configurado desde el modal.')
      }
      if (!ctaVisible) {
        throw new Error('La seccion de CTA no esta visible en este paso.')
      }
      if (!ctaLabel) {
        throw new Error('No tengo CTA sugerido para el anuncio.')
      }
      const ctaSection = await locateDynamicSection(page, {
        labels: ['Llamada a la acción', 'Llamada a la accion', 'Call to action'],
        controlType: 'combobox',
      }, 3200).catch(() => null)
      if (!ctaSection) {
        throw new Error(`No encontre la seccion de CTA para "${ctaLabel}".`)
      }
      await selectDropdownOptionInLocator(
        ctaSection,
        page,
        [ctaLabel, 'Registrarte', 'Sign up', 'Más información', 'Mas información', 'Learn more'],
        `No encontre el selector de CTA para "${ctaLabel}".`
      )
      await logFacebookUiStep(`CTA del anuncio alineado con la recomendacion del ads-analyst: ${ctaLabel}.`)
      ctaConfigured = true
    } catch (error) {
      if (!ctaConfigured && ctaVisible) {
        await logFacebookUiStep(`No pude ajustar el CTA del anuncio: ${error.message || error}`, 'warning')
      }
    }
  }

  if (!onlyReplaceImage) {
    try {
      if (!formVisible) {
        throw new Error('La seccion de formulario instantaneo no esta visible en este paso.')
      }
      if (!selectedLeadgenFormId && !selectedLeadgenFormName && !expectedLeadFormName) {
        throw new Error('No hay formulario Instant Form seleccionado en el flujo.')
      }
      const leadFormSection = await locateDynamicSection(page, {
        labels: ['Formulario instantáneo', 'Formulario instantaneo', 'Instant form'],
        controlType: 'combobox',
      }, 3200).catch(() => null)
      if (!leadFormSection) {
        throw new Error(`No encontre la seccion de formulario instantaneo ${selectedLeadgenFormName || selectedLeadgenFormId || expectedLeadFormName}.`)
      }
      await selectDropdownOptionInLocator(
        leadFormSection,
        page,
        [selectedLeadgenFormName, selectedLeadgenFormId, expectedLeadFormName].filter(Boolean),
        `No encontre el selector del formulario instantaneo ${selectedLeadgenFormName || selectedLeadgenFormId || expectedLeadFormName}.`
      )
      await logFacebookUiStep(`Formulario instantaneo del anuncio alineado con ${selectedLeadgenFormName || selectedLeadgenFormId || expectedLeadFormName}.`)
      leadFormConfigured = true
    } catch (error) {
      if (formVisible) {
        await logFacebookUiStep(`No pude ajustar el formulario instantaneo del anuncio: ${error.message || error}`, 'warning')
      }
    }
  }

  const contentVisible = visibleSections.some((item) => /contenido del anuncio|texto principal|titulo|título|descripcion|descripción/i.test(String(item)))
  const imageVisible = visibleSections.some((item) => /contenido del anuncio/i.test(String(item)))
  const canFinalize = onlyReplaceImage
    ? (!imageVisible || imageConfigured)
    : (
      nameFilled &&
      (!imageVisible || imageConfigured) &&
      (!destinationVisible || destinationConfigured) &&
      (!contentVisible || (primaryTextConfigured && headlineConfigured && descriptionConfigured)) &&
      (!ctaVisible || ctaConfigured) &&
      (!formVisible || leadFormConfigured)
    )

  if (!canFinalize) {
    await logFacebookUiStep('No finalizare la campaña todavia porque el apartado del anuncio sigue con campos visibles pendientes.', 'warning')
  }

  return {
    reachedEditor: true,
    nameFilled,
    imageConfigured,
    destinationConfigured,
    primaryTextConfigured,
    headlineConfigured,
    descriptionConfigured,
    ctaConfigured,
    leadFormConfigured,
    visibleSections,
    canFinalize,
  }
}

module.exports = {
  isFacebookAdEditorReady,
  getVisibleAdEditorSectionNames,
  openPhotoAdContentModal,
  selectModalPageTab,
  selectNoyecodeSourceInModal,
  selectFirstNoyecodeImageInModal,
  clickModalPrimaryAction,
  completePhotoAdContentModalFlow,
  configureAdDestinationField,
  ensureAdContentImageConfigured,
  tryFacebookUiReachAdEditor,
}
