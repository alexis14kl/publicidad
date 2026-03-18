const IMAGE_FORMATS = {
  'fb-vertical':   { platform: 'Facebook',  label: 'Vertical 4:5',      w: 1080, h: 1350, ratio: '4:5' },
  'fb-square':     { platform: 'Facebook',  label: 'Square 1:1',        w: 1080, h: 1080, ratio: '1:1' },
  'fb-horizontal': { platform: 'Facebook',  label: 'Horizontal 1.91:1', w: 1200, h: 628,  ratio: '1.91:1' },
  'fb-story':      { platform: 'Facebook',  label: 'Story 9:16',        w: 1080, h: 1920, ratio: '9:16' },
  'ig-vertical':   { platform: 'Instagram', label: 'Vertical 4:5',      w: 1080, h: 1350, ratio: '4:5' },
  'ig-square':     { platform: 'Instagram', label: 'Square 1:1',        w: 1080, h: 1080, ratio: '1:1' },
  'ig-story':      { platform: 'Instagram', label: 'Story 9:16',        w: 1080, h: 1920, ratio: '9:16' },
  'ig-landscape':  { platform: 'Instagram', label: 'Horizontal 1.91:1', w: 1080, h: 566,  ratio: '1.91:1' },
  'tt-vertical':   { platform: 'TikTok',    label: 'Vertical 9:16',     w: 1080, h: 1920, ratio: '9:16' },
  'tt-square':     { platform: 'TikTok',    label: 'Square 1:1',        w: 1080, h: 1080, ratio: '1:1' },
  'li-horizontal': { platform: 'LinkedIn',  label: 'Horizontal 1.91:1', w: 1200, h: 628,  ratio: '1.91:1' },
  'li-square':     { platform: 'LinkedIn',  label: 'Square 1:1',        w: 1080, h: 1080, ratio: '1:1' },
  'li-vertical':   { platform: 'LinkedIn',  label: 'Vertical 4:5',      w: 1080, h: 1350, ratio: '4:5' },
  'li-story':      { platform: 'LinkedIn',  label: 'Story 9:16',        w: 1080, h: 1920, ratio: '9:16' },
}

module.exports = { IMAGE_FORMATS }
