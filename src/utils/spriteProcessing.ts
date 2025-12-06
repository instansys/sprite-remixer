import type { FrameData, OutputFormat, SourceImage } from '../types'
import type { BackgroundColorSource } from '../imageProcessing'
import { scaleImageNearestNeighbor, removeBackgroundFromImage, exportCanvas } from '../imageProcessing'

interface ProcessSpritesOptions {
  sourceImages: SourceImage[]
  selectedFrames: FrameData[]
  targetWidth: number
  targetHeight: number
  outputCols: number
  outputFormat: OutputFormat
  removeBackground: boolean
  backgroundTolerance: number
  edgeErosion: number
  bgColorSource: BackgroundColorSource
}

export async function processSprites(options: ProcessSpritesOptions): Promise<string | null> {
  const {
    sourceImages,
    selectedFrames,
    targetWidth,
    targetHeight,
    outputCols: outputColsSetting,
    outputFormat,
    removeBackground,
    backgroundTolerance,
    edgeErosion,
    bgColorSource
  } = options

  if (sourceImages.length === 0 || selectedFrames.length === 0) {
    return null
  }

  // Load all source images first
  const loadedImages: { [key: number]: HTMLImageElement } = {}
  await Promise.all(
    sourceImages.map((source, idx) => {
      return new Promise<void>((resolve) => {
        const img = new Image()
        img.onload = () => {
          loadedImages[idx] = img
          resolve()
        }
        img.src = source.imageUrl
      })
    })
  )

  // Calculate output layout (0 = auto)
  const outputCols = outputColsSetting > 0 ? outputColsSetting : Math.ceil(Math.sqrt(selectedFrames.length))
  const outputRows = Math.ceil(selectedFrames.length / outputCols)

  const resultCanvas = document.createElement('canvas')
  resultCanvas.width = outputCols * targetWidth
  resultCanvas.height = outputRows * targetHeight
  const ctx = resultCanvas.getContext('2d', {
    alpha: true,
    colorSpace: 'srgb',
    willReadFrequently: true
  })
  if (!ctx) return null

  ctx.imageSmoothingEnabled = false
  ctx.imageSmoothingQuality = 'low'

  selectedFrames.forEach((frame, idx) => {
    const destCol = idx % outputCols
    const destRow = Math.floor(idx / outputCols)

    const sourceImg = loadedImages[frame.sourceIndex]
    const source = sourceImages[frame.sourceIndex]
    if (!sourceImg || !source) return

    const frameWidth = sourceImg.width / source.cols
    const frameHeight = sourceImg.height / source.rows
    const srcX = frame.x * frameWidth
    const srcY = frame.y * frameHeight

    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = frameWidth
    tempCanvas.height = frameHeight
    const tempCtx = tempCanvas.getContext('2d', {
      alpha: true,
      colorSpace: 'srgb',
      willReadFrequently: true
    })
    if (!tempCtx) return

    tempCtx.imageSmoothingEnabled = false
    tempCtx.imageSmoothingQuality = 'low'

    tempCtx.drawImage(
      sourceImg,
      srcX,
      srcY,
      frameWidth,
      frameHeight,
      0,
      0,
      frameWidth,
      frameHeight
    )

    const scaledCanvas = scaleImageNearestNeighbor(tempCanvas, targetWidth, targetHeight)
    const scaledCtx = scaledCanvas.getContext('2d')
    if (!scaledCtx) return

    if (removeBackground) {
      const imageData = scaledCtx.getImageData(0, 0, targetWidth, targetHeight)
      const processedData = removeBackgroundFromImage(
        imageData,
        targetWidth,
        targetHeight,
        backgroundTolerance,
        edgeErosion,
        bgColorSource
      )
      scaledCtx.putImageData(processedData, 0, 0)
    }

    ctx.drawImage(
      scaledCanvas,
      0,
      0,
      targetWidth,
      targetHeight,
      destCol * targetWidth,
      destRow * targetHeight,
      targetWidth,
      targetHeight
    )
  })

  return exportCanvas(resultCanvas, outputFormat)
}

export function downloadImage(imageUrl: string, filename: string = 'sprite-sheet-pixel-art.png') {
  const link = document.createElement('a')
  link.download = filename
  link.href = imageUrl
  link.click()
}
