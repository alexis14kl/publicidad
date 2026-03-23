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

function buildCompanyCredentialEnv(companyName) {
  const company = lookupCompanyData(companyName)
  if (!company || !company.activo) {
    return null
  }

  const envUpdates = {
    FB_ACCESS_TOKEN: '',
    FB_PAGE_ID: '',
    INSTAGRAM_ACCESS_TOKEN: '',
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

    envUpdates[platformConfig.tokenEnvKey] = String(primaryAccount.token || '').trim()
    if (platformRecord.platform === 'facebook') {
      envUpdates.FB_PAGE_ID = String(primaryAccount.page_id || '').trim()
    }
    if (platformRecord.platform === 'instagram') {
      envUpdates.INSTAGRAM_ACCOUNT_ID = String(primaryAccount.account_id || primaryAccount.page_id || '').trim()
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

  return (
    'Generate this image now: Professional advertising image, realistic photography style ' +
    'for social media marketing. Young real person working with laptop in modern professional ' +
    'environment. Positive expression showing success. Clean layout with corporate text blocks, ' +
    'large headline, orange CTA badge, benefits box, and contact banner at bottom. ' +
    'Digital dashboards and floating tech interfaces around the person. ' +
    'NO cartoons, NO illustrations, NO vectors. Only realistic high-quality photography. ' +
    'All visible text in the image MUST be in Spanish.\n\n' +
    body +
    '\n\nCRITICAL: Reserve only a small clean area near the top center for the logo and a ' +
    'compact floating contact pill near the bottom. Do NOT create giant white header bars or ' +
    'full-width footer strips. Keep the composition premium, airy and balanced like a polished ' +
    'social ad. The contact data and logo will be finished programmatically later, so avoid ' +
    'placing critical text in the top 8% and bottom 14% of the image. Full-bleed design, light ' +
    'background edge to edge, no margins, no black bars. Deliver exactly ONE final image.'
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
    `DESIGN REQUIREMENTS (premium, agency-level quality):\n` +
    `- TWO pages, Letter size (8.5x11in). Page 2: page-break-before:always\n` +
    `- PAGE 1 (FRONT): Hero section with large bold headline, company tagline, decorative geometric shapes (circles, diagonal lines, gradient overlays), logo prominently placed, striking visual composition with layered elements\n` +
    `- PAGE 2 (BACK): Services/benefits grid with icons (use Unicode ✓ ★ ⚡ ⭐ ➤ •), testimonial quote section, contact info footer with clean layout\n` +
    `- Use CSS gradients, box-shadows (0 12px 32px rgba(0,0,0,0.08)), border-radius (20px+ on cards), transforms for depth\n` +
    `- Add decorative elements: diagonal color bars, rounded accent shapes, semi-transparent overlays, subtle dot patterns via radial-gradient\n` +
    `- Typography: font-family 'Segoe UI',Arial,sans-serif; titles 2.2em+ font-weight:900; subtitles 1.3em weight:700; body 0.95em weight:400; generous line-height (1.6+)\n` +
    `- Layout: CSS Grid with named areas, generous whitespace, clear visual hierarchy\n` +
    `- Cards: background rgba(255,255,255,0.92), backdrop-filter:blur(4px), subtle border, rounded corners\n` +
    `- Dark footer section with inverted text (#fff), contact grid, CTA pill button\n` +
    `- Each .page section must have overflow:hidden and position:relative\n\n` +
    `PRINT-SAFE CSS (mandatory):\n` +
    `  @page{size:letter;margin:0}\n` +
    `  *{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}\n` +
    `  h1,h2,h3,h4{break-after:avoid} .card,.service,.benefit{break-inside:avoid}\n` +
    `  All CSS in <style> tag, self-contained, NO external resources, NO <table> layouts\n` +
    `  ALL visible text MUST be in SPANISH\n\n` +
    `IMPORTANT: Output COMPLETE HTML. Start with <!DOCTYPE html>, end with </html>. Do NOT truncate.`
  )
}

module.exports = {
  lookupCompanyData,
  isCompanyActive,
  buildCompanyCredentialEnv,
  buildCompanyRule,
  buildColorRule,
  buildServiceRule,
  buildFormatRule,
  buildFullPrompt,
  buildBrochurePrompt,
}
