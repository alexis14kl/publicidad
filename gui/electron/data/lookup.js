const { COMPANY_PLATFORMS } = require('../config/company-platforms')
const { IMAGE_FORMATS } = require('../config/image-formats')
const { NOYECODE_SERVICES } = require('../config/noyecode-services')
const { aggregateCompanyRows, fetchCompanyRowsForPlatform, getCompanyPlatformConfig } = require('./db')

function lookupCompanyData(companyName) {
  if (!companyName) return null
  try {
    const records = aggregateCompanyRows(
      Object.fromEntries([...COMPANY_PLATFORMS].map(p => [p, fetchCompanyRowsForPlatform(p)]))
    )
    return records.find(c => c.nombre === companyName) || null
  } catch { return null }
}

function isCompanyActive(companyName) {
  const company = lookupCompanyData(companyName)
  return !!company?.activo
}

function getDefaultActiveCompany() {
  /** Returns the first active company from the database, or null. */
  try {
    const records = aggregateCompanyRows(
      Object.fromEntries([...COMPANY_PLATFORMS].map(p => [p, fetchCompanyRowsForPlatform(p)]))
    )
    return records.find(c => !!c.activo) || null
  } catch { return null }
}

function buildCompanyCredentialEnv(companyName) {
  const company = lookupCompanyData(companyName)
  if (!company || !company.activo) {
    return null
  }

  const envUpdates = {
    FB_ACCESS_TOKEN: '',
    FB_PAGE_ID: '',
    LINKEDIN_ACCESS_TOKEN: '',
    TIKTOK_ACCESS_TOKEN: '',
    GOOGLE_ADS_ACCESS_TOKEN: '',
  }

  for (const platformRecord of company.platforms || []) {
    const platformConfig = getCompanyPlatformConfig(platformRecord.platform)
    const primaryAccount =
      (platformRecord.accounts || []).find((account) => Number(account.is_primary || 0) === 1) ||
      (platformRecord.accounts || [])[0]

    if (!primaryAccount?.token) continue

    // Instagram reutiliza el token de Facebook — no necesita token separado.
    // El IG User ID se auto-resuelve desde la Facebook Page vinculada.
    if (platformRecord.platform === 'instagram') {
      // Si el usuario configuró un token específico de Instagram, usarlo como fallback
      if (primaryAccount.token) {
        envUpdates.INSTAGRAM_ACCESS_TOKEN = String(primaryAccount.token).trim()
      }
      continue
    }

    envUpdates[platformConfig.tokenEnvKey] = String(primaryAccount.token || '').trim()
    if (platformRecord.platform === 'facebook') {
      envUpdates.FB_PAGE_ID = String(primaryAccount.page_id || '').trim()
    }
  }

  return envUpdates
}

function buildCompanyRule(companyName) {
  const company = lookupCompanyData(companyName)
  if (!company || !company.activo) return ''
  const name = company.nombre || 'xxxxxx'
  const phone = company.telefono || 'xxxxxx'
  const email = company.correo || 'xxxxxx'
  const website = company.sitio_web || 'xxxxxx'
  const address = company.direccion || 'xxxxxx'
  return (
    `\n\n[MANDATORY COMPANY INFO — USE THIS BUSINESS DATA IN THE IMAGE]\n` +
    `Company name: "${name}". ` +
    `Website: "${website}". Phone/WhatsApp: "${phone}". ` +
    `Email: "${email}". Address: "${address}". ` +
    `Use this EXACT contact information in the ad image. ` +
    `Do NOT use "noyecode.com" or "+57 301 385 9952" or any other hardcoded data. ` +
    `The contact info in the image must match the company selected by the client.`
  )
}

function buildColorRule(companyName) {
  const company = lookupCompanyData(companyName)
  const p = company?.color_primario || '#3469ED'
  const c = company?.color_cta || '#fd9102'
  const a = company?.color_acento || '#00bcd4'
  const k = company?.color_checks || '#28a745'
  const f = company?.color_fondo || '#f0f0f5'
  return (
    `\n\n[MANDATORY BRAND COLORS — USE THESE EXACT COLORS IN THE IMAGE]\n` +
    `Primary color (titles, headings): ${p}. ` +
    `CTA color (buttons, badges, call-to-action): ${c}. ` +
    `Accent color (tech details, decorative elements): ${a}. ` +
    `Check color (benefit checkmarks): ${k}. ` +
    `Background color: ${f}. ` +
    `Do NOT use any other color palette. These are the client's brand colors. ` +
    `NEVER use dark or black backgrounds. The style must be LIGHT, clean and colorful.`
  )
}

function buildServiceRule(serviceValue) {
  const label = NOYECODE_SERVICES[serviceValue]
  if (!label) return ''
  return (
    `\n\n[MANDATORY SERVICE — THIS IS THE ONLY SERVICE TO PROMOTE]\n` +
    `Service: "${label}". ` +
    `The ad image MUST promote ONLY this service: "${label}". ` +
    `Do NOT mix with other services. Do NOT change the service name. ` +
    `All text, headlines, and benefits in the image must be about "${label}". ` +
    `This is a hard requirement from the client.\n\n` +
    `[MANDATORY LANGUAGE — ALL TEXT IN THE IMAGE MUST BE IN SPANISH]\n` +
    `Every piece of text visible in the image (headlines, subtitles, benefits, CTA, contact info) ` +
    `MUST be written in Spanish. Do NOT use English for any visible text in the image. ` +
    `The prompt instructions are in English but the IMAGE CONTENT must be 100% in Spanish.`
  )
}

function buildFormatRule(formatValue) {
  const fmt = IMAGE_FORMATS[formatValue]
  if (!fmt) return ''
  return (
    `\n\n[MANDATORY IMAGE FORMAT — THIS OVERRIDES ANY OTHER SIZE INSTRUCTION]\n` +
    `Platform: ${fmt.platform}. Aspect ratio: ${fmt.ratio}. ` +
    `Resolution: exactly ${fmt.w}x${fmt.h} pixels. ` +
    `Orientation: ${fmt.h > fmt.w ? 'vertical (portrait)' : fmt.h === fmt.w ? 'square' : 'horizontal (landscape)'}. ` +
    `YOU MUST generate the image at ${fmt.w}x${fmt.h} pixels with ${fmt.ratio} aspect ratio. ` +
    `Do NOT use any other dimensions. This is a hard requirement from the client.`
  )
}

function buildFullPrompt(userIdea, companyName, imageService, imageFormat) {
  // NOTE: prompt_seed.txt is NOT included here — it contains meta-instructions
  // meant for the n8n AI prompt generator ("Genera UN SOLO prompt en ingles
  // listo para DALL-E..."). When pasted directly into ChatGPT, those meta-
  // instructions cause ChatGPT to output plain text instead of calling DALL-E.
  //
  // Instead, we build a DIRECT image-generation request with "Generate this
  // image now:" prefix (matching what clean_generated_prompt() in
  // n8n_prompt_client.py produces) so ChatGPT invokes DALL-E.
  //
  // When this function returns '' (no user idea + no mandatory rules),
  // BOT_CUSTOM_IMAGE_PROMPT stays unset and the orchestrator falls through
  // to the n8n path which correctly processes the seed.

  const parts = []
  if (userIdea) {
    parts.push(userIdea)
  }
  parts.push(buildCompanyRule(companyName))
  parts.push(buildColorRule(companyName))
  parts.push(buildServiceRule(imageService))
  parts.push(buildFormatRule(imageFormat))

  const body = parts.join('').trim()
  if (!body) return ''

  // The user's idea IS the prompt. No fixed templates.
  // ChatGPT must generate based on what the user described, not a generic template.
  return (
    'Generate this image now:\n\n' +
    'CONCEPT: ' + (userIdea || 'advertising image') + '\n\n' +
    body + '\n\n' +
    'STYLE: Realistic high-quality photography for social media advertising. ' +
    'The image must visually represent the CONCEPT above — do NOT default to a generic person with a laptop. ' +
    'Be creative and literal about what was described. ' +
    'All visible text in the image MUST be in Spanish.\n\n' +
    'LAYOUT: Full-bleed design, no margins, no black bars. ' +
    'Reserve the top 8% clean for a logo overlay (added later). ' +
    'Reserve the bottom 14% for a contact pill (added later). ' +
    'Deliver exactly ONE final image.'
  )
}

function buildBrochurePrompt(userIdea, companyName, customColors) {
  const company = lookupCompanyData(companyName)
  const name = company?.nombre || 'Empresa'
  const phone = company?.telefono || ''
  const email = company?.correo || ''
  const website = company?.sitio_web || ''
  const address = company?.direccion || ''
  const description = company?.descripcion || ''

  const colors = {
    primario: customColors?.color_primario || company?.color_primario || '#3469ED',
    cta: customColors?.color_cta || company?.color_cta || '#fd9102',
    acento: customColors?.color_acento || company?.color_acento || '#00bcd4',
    checks: customColors?.color_checks || company?.color_checks || '#28a745',
    fondo: customColors?.color_fondo || company?.color_fondo || '#f0f0f5',
  }

  return (
    `You are an elite graphic designer at a top branding agency. Write the COMPLETE HTML/CSS for a PREMIUM brochure as PLAIN TEXT.\n` +
    `Do NOT use code blocks, backticks, or explanations. Start directly with <!DOCTYPE html> and end with </html>. Nothing before or after.\n\n` +
    `CONCEPT: ${userIdea}\n` +
    `COMPANY: "${name}"` + (description ? ` — ${description}` : '') + `\n` +
    (phone ? `PHONE: ${phone}\n` : '') +
    (email ? `EMAIL: ${email}\n` : '') +
    (website ? `WEB: ${website}\n` : '') +
    (address ? `ADDRESS: ${address}\n` : '') +
    `LOGO: <img src="logo" alt="Logo"> (will be replaced programmatically)\n\n` +
    `COLOR PALETTE:\n` +
    `  primary=${colors.primario} → headings, key accents, brand elements\n` +
    `  cta=${colors.cta} → buttons, badges, call-to-action highlights\n` +
    `  accent=${colors.acento} → decorative elements, secondary highlights, tech details\n` +
    `  checks=${colors.checks} → checkmarks, success indicators, list bullets\n` +
    `  bg=${colors.fondo} → page background\n\n` +
    `DESIGN REQUIREMENTS (premium brochure for PDF print):\n` +
    `- TWO pages, Letter size (8.5x11in)\n` +
    `- PAGE 1: Logo+company top, hero headline, subtitle, 2 CTA buttons, "why choose us" with checkmarks, contact info\n` +
    `- PAGE 2: Services with icons (✓ ★ ⚡ ➤), benefits, testimonial quote, dark footer with contact+CTA\n` +
    `- Professional look: gradients, box-shadows, border-radius, color accents\n\n` +
    `MANDATORY CSS RULES (wkhtmltopdf compatibility — MUST follow):\n` +
    `- @page{size:letter;margin:0} *{print-color-adjust:exact;-webkit-print-color-adjust:exact;box-sizing:border-box}\n` +
    `- FORBIDDEN: display:grid, display:flex, position:absolute, overflow:hidden, backdrop-filter, clip-path, mask-image\n` +
    `- For 2 columns: use float:left with width:48% and margin-right:4% on left column, clear:both after\n` +
    `- For card rows: use display:inline-block with width:30% or float:left with width:31% + margin\n` +
    `- For centering: use text-align:center or margin:0 auto with fixed width\n` +
    `- For vertical spacing: use margin and padding only\n` +
    `- Page 2: page-break-before:always on second section\n` +
    `- Always add <div style="clear:both"></div> after floated sections\n` +
    `- Use background-color and linear-gradient for decorative backgrounds (these work)\n` +
    `- All CSS in <style> tag, self-contained, NO external resources\n` +
    `- ALL visible text MUST be in SPANISH\n\n` +
    `IMPORTANT: Output COMPLETE HTML from <!DOCTYPE html> to </html>. Do NOT truncate.`
  )
}

module.exports = {
  lookupCompanyData,
  isCompanyActive,
  getDefaultActiveCompany,
  buildCompanyCredentialEnv,
  buildCompanyRule,
  buildColorRule,
  buildServiceRule,
  buildFormatRule,
  buildFullPrompt,
  buildBrochurePrompt,
}
