const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { PROJECT_ROOT } = require('../config/project-paths')

function getMarketingImagesDir() {
  return path.join(PROJECT_ROOT, 'img_publicitarias')
}

function getLatestMarketingImage() {
  const imagesDir = getMarketingImagesDir()
  if (!fs.existsSync(imagesDir)) {
    return null
  }

  const imageFiles = fs.readdirSync(imagesDir)
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .map((name) => {
      const fullPath = path.join(imagesDir, name)
      const stat = fs.statSync(fullPath)
      return { name, fullPath, mtimeMs: stat.mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  return imageFiles[0] || null
}

function getImageDimensionsWithSips(filePath) {
  const output = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], {
    encoding: 'utf-8',
  })
  const widthMatch = output.match(/pixelWidth:\s+(\d+)/)
  const heightMatch = output.match(/pixelHeight:\s+(\d+)/)
  const width = widthMatch ? Number(widthMatch[1]) : 0
  const height = heightMatch ? Number(heightMatch[1]) : 0
  return { width, height }
}

function prepareLatestMarketingImageAsset() {
  const latest = getLatestMarketingImage()
  if (!latest) {
    return null
  }

  const sourcePath = latest.fullPath
  let dimensions = { width: 0, height: 0 }
  try {
    dimensions = getImageDimensionsWithSips(sourcePath)
  } catch {
    return {
      sourcePath,
      preparedPath: sourcePath,
      fileName: latest.name,
      width: 0,
      height: 0,
      adjusted: false,
      adjustmentReason: 'No se pudieron leer las dimensiones; se usara el archivo original.',
      status: 'original',
    }
  }

  const targetWidth = 1200
  const targetHeight = 628
  const targetRatio = targetWidth / targetHeight
  const currentRatio = dimensions.width > 0 && dimensions.height > 0 ? dimensions.width / dimensions.height : 0
  const alreadyClose = currentRatio > 0 && Math.abs(currentRatio - targetRatio) < 0.03

  if (alreadyClose) {
    return {
      sourcePath,
      preparedPath: sourcePath,
      fileName: latest.name,
      width: dimensions.width,
      height: dimensions.height,
      adjusted: false,
      adjustmentReason: 'La imagen ya tiene una proporcion cercana a Facebook Feed.',
      status: 'ready',
    }
  }

  const preparedDir = path.join(getMarketingImagesDir(), '_prepared')
  fs.mkdirSync(preparedDir, { recursive: true })
  const preparedPath = path.join(preparedDir, `feed_${latest.name.replace(/\.(png|jpe?g|webp)$/i, '.png')}`)

  try {
    const cropWidth = currentRatio >= targetRatio
      ? Math.round(dimensions.height * targetRatio)
      : dimensions.width
    const cropHeight = currentRatio >= targetRatio
      ? dimensions.height
      : Math.round(dimensions.width / targetRatio)

    execFileSync('/usr/bin/sips', ['-c', String(cropHeight), String(cropWidth), sourcePath, '--out', preparedPath], {
      encoding: 'utf-8',
    })
    execFileSync('/usr/bin/sips', ['-z', String(targetHeight), String(targetWidth), preparedPath], {
      encoding: 'utf-8',
    })

    return {
      sourcePath,
      preparedPath,
      fileName: latest.name,
      width: dimensions.width,
      height: dimensions.height,
      adjusted: true,
      adjustmentReason: `El agente preparo una version Facebook Feed ${targetWidth}x${targetHeight} desde ${dimensions.width}x${dimensions.height}.`,
      status: 'prepared',
    }
  } catch (error) {
    return {
      sourcePath,
      preparedPath: sourcePath,
      fileName: latest.name,
      width: dimensions.width,
      height: dimensions.height,
      adjusted: false,
      adjustmentReason: `No se pudo preparar la imagen automaticamente: ${error.message || error}`,
      status: 'fallback_original',
    }
  }
}

module.exports = {
  getMarketingImagesDir,
  getLatestMarketingImage,
  getImageDimensionsWithSips,
  prepareLatestMarketingImageAsset,
}
