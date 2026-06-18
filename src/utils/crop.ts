import type { CropMargins, OutputFormat } from '../types'
import { exportCanvas } from '../imageProcessing'

export const DEFAULT_CROP_MARGINS: CropMargins = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0
}

interface CropSpriteSheetOptions {
  imageUrl: string
  frameWidth: number
  frameHeight: number
  frameCount: number
  outputCols: number
  crop: CropMargins
  outputFormat: OutputFormat
  preserveOriginalWhenUncropped?: boolean
}

interface DetectSpriteSheetAlphaCropOptions {
  imageUrl: string
  frameWidth: number
  frameHeight: number
  frameCount: number
  outputCols: number
  alphaThreshold?: number
}

function clampDimension(value: number): number {
  return Math.max(1, Math.round(value))
}

function sanitizeMargin(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = imageUrl
  })
}

export function resolveSpriteSheetOutputCols(outputCols: number, frameCount: number): number {
  if (outputCols > 0) return outputCols
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, frameCount))))
}

export function normalizeCropMargins(
  crop: Partial<CropMargins> | undefined,
  frameWidth: number,
  frameHeight: number
): CropMargins {
  const width = clampDimension(frameWidth)
  const height = clampDimension(frameHeight)
  const maxHorizontalCrop = width - 1
  const maxVerticalCrop = height - 1

  const left = Math.min(sanitizeMargin(crop?.left), maxHorizontalCrop)
  const right = Math.min(sanitizeMargin(crop?.right), maxHorizontalCrop - left)
  const top = Math.min(sanitizeMargin(crop?.top), maxVerticalCrop)
  const bottom = Math.min(sanitizeMargin(crop?.bottom), maxVerticalCrop - top)

  return { top, right, bottom, left }
}

export function areCropMarginsEqual(a: CropMargins, b: CropMargins): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left
}

export function isCropMarginsEmpty(crop: CropMargins): boolean {
  return crop.top === 0 && crop.right === 0 && crop.bottom === 0 && crop.left === 0
}

export function getCroppedFrameSize(
  crop: CropMargins,
  frameWidth: number,
  frameHeight: number
): { width: number; height: number } {
  const normalized = normalizeCropMargins(crop, frameWidth, frameHeight)
  return {
    width: clampDimension(frameWidth) - normalized.left - normalized.right,
    height: clampDimension(frameHeight) - normalized.top - normalized.bottom
  }
}

export async function cropSpriteSheet(options: CropSpriteSheetOptions): Promise<string | null> {
  const {
    imageUrl,
    frameWidth,
    frameHeight,
    frameCount,
    outputCols: outputColsSetting,
    crop,
    outputFormat,
    preserveOriginalWhenUncropped = true
  } = options

  if (frameCount <= 0) return null

  const sourceFrameWidth = clampDimension(frameWidth)
  const sourceFrameHeight = clampDimension(frameHeight)
  const normalizedCrop = normalizeCropMargins(crop, sourceFrameWidth, sourceFrameHeight)

  if (preserveOriginalWhenUncropped && isCropMarginsEmpty(normalizedCrop)) {
    return imageUrl
  }

  const outputCols = resolveSpriteSheetOutputCols(outputColsSetting, frameCount)
  const outputRows = Math.ceil(frameCount / outputCols)
  const croppedSize = getCroppedFrameSize(normalizedCrop, sourceFrameWidth, sourceFrameHeight)
  const img = await loadImage(imageUrl)

  const resultCanvas = document.createElement('canvas')
  resultCanvas.width = outputCols * croppedSize.width
  resultCanvas.height = outputRows * croppedSize.height
  const ctx = resultCanvas.getContext('2d', {
    alpha: true,
    colorSpace: 'srgb',
    willReadFrequently: true
  })

  if (!ctx) return null

  ctx.imageSmoothingEnabled = false
  ctx.imageSmoothingQuality = 'low'

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const sourceCol = frameIndex % outputCols
    const sourceRow = Math.floor(frameIndex / outputCols)
    const sourceX = sourceCol * sourceFrameWidth + normalizedCrop.left
    const sourceY = sourceRow * sourceFrameHeight + normalizedCrop.top
    const destX = sourceCol * croppedSize.width
    const destY = sourceRow * croppedSize.height

    ctx.drawImage(
      img,
      sourceX,
      sourceY,
      croppedSize.width,
      croppedSize.height,
      destX,
      destY,
      croppedSize.width,
      croppedSize.height
    )
  }

  return exportCanvas(resultCanvas, outputFormat)
}

export async function detectSpriteSheetAlphaCrop(
  options: DetectSpriteSheetAlphaCropOptions
): Promise<CropMargins> {
  const {
    imageUrl,
    frameWidth,
    frameHeight,
    frameCount,
    outputCols: outputColsSetting,
    alphaThreshold = 8
  } = options

  if (frameCount <= 0) return { ...DEFAULT_CROP_MARGINS }

  const sourceFrameWidth = clampDimension(frameWidth)
  const sourceFrameHeight = clampDimension(frameHeight)
  const outputCols = resolveSpriteSheetOutputCols(outputColsSetting, frameCount)
  const img = await loadImage(imageUrl)

  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  const ctx = canvas.getContext('2d', {
    alpha: true,
    colorSpace: 'srgb',
    willReadFrequently: true
  })

  if (!ctx) return { ...DEFAULT_CROP_MARGINS }

  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0)

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { data } = imageData
  let left = sourceFrameWidth
  let top = sourceFrameHeight
  let right = -1
  let bottom = -1

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const sourceCol = frameIndex % outputCols
    const sourceRow = Math.floor(frameIndex / outputCols)
    const baseX = sourceCol * sourceFrameWidth
    const baseY = sourceRow * sourceFrameHeight

    for (let y = 0; y < sourceFrameHeight; y++) {
      const imageY = baseY + y
      if (imageY >= canvas.height) continue

      for (let x = 0; x < sourceFrameWidth; x++) {
        const imageX = baseX + x
        if (imageX >= canvas.width) continue

        const alpha = data[(imageY * canvas.width + imageX) * 4 + 3]
        if (alpha <= alphaThreshold) continue

        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
      }
    }
  }

  if (right < 0 || bottom < 0) {
    return { ...DEFAULT_CROP_MARGINS }
  }

  return normalizeCropMargins({
    left,
    top,
    right: sourceFrameWidth - right - 1,
    bottom: sourceFrameHeight - bottom - 1
  }, sourceFrameWidth, sourceFrameHeight)
}
