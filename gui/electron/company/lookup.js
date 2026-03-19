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
    '\n\nCRITICAL: The top 15% of the image must be completely empty with clean light ' +
    'background only, no text, no icons, no elements of any kind. The bottom 12% of the image ' +
    'must also stay clean and free of important text because the real contact bar is added ' +
    'programmatically later with the company website and phone. Logo is added ' +
    'programmatically later. Full-bleed design, light background edge to edge, no margins, ' +
    'no black bars. Deliver exactly ONE final image.'
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
}
