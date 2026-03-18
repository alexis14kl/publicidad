const COMPANY_PLATFORMS = new Set(['facebook', 'tiktok', 'linkedin', 'instagram', 'googleads'])

const COMPANY_PLATFORM_CONFIG = {
  facebook: {
    label: 'Facebook',
    dbFile: 'facebook.sqlite3',
    schemaFile: 'facebook.sql',
    table: 'facebook_form',
    tokenEnvKey: 'FB_ACCESS_TOKEN',
  },
  tiktok: {
    label: 'TikTok',
    dbFile: 'tiktok.sqlite3',
    schemaFile: 'tiktok.sql',
    table: 'tiktok_form',
    tokenEnvKey: 'TIKTOK_ACCESS_TOKEN',
  },
  linkedin: {
    label: 'LinkedIn',
    dbFile: 'linkedin.sqlite3',
    schemaFile: 'linkedin.sql',
    table: 'linkedin_form',
    tokenEnvKey: 'LINKEDIN_ACCESS_TOKEN',
  },
  instagram: {
    label: 'Instagram',
    dbFile: 'instagram.sqlite3',
    schemaFile: 'instagram.sql',
    table: 'instagram_form',
    tokenEnvKey: 'INSTAGRAM_ACCESS_TOKEN',
  },
  googleads: {
    label: 'Google Ads',
    dbFile: 'googleads.sqlite3',
    schemaFile: 'googleads.sql',
    table: 'googleads_form',
    tokenEnvKey: 'GOOGLE_ADS_ACCESS_TOKEN',
  },
}

module.exports = {
  COMPANY_PLATFORM_CONFIG,
  COMPANY_PLATFORMS,
}
