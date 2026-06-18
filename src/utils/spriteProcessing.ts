import type { FrameData, OutputFormat, SourceImage } from '../types'
import type { BackgroundColorSource } from '../imageProcessing'
import {
  scaleImageNearestNeighbor,
  scaleImageWithPixelSnap,
  removeBackgroundFromImage,
  flipCanvasHorizontal,
  exportCanvas
} from '../imageProcessing'
import { buildStablePixelSnapTargets, extractFrameCanvas } from './pixelSnapTargets'

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
  fillInterior: boolean
  pixelPerfectResize: boolean
  flipHorizontal: boolean
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
    bgColorSource,
    fillInterior,
    pixelPerfectResize,
    flipHorizontal
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

  const pixelSnapTargets = pixelPerfectResize
    ? buildStablePixelSnapTargets(sourceImages, selectedFrames, loadedImages)
    : {}

  selectedFrames.forEach((frame, idx) => {
    const destCol = idx % outputCols
    const destRow = Math.floor(idx / outputCols)

    const sourceImg = loadedImages[frame.sourceIndex]
    const source = sourceImages[frame.sourceIndex]
    if (!sourceImg || !source) return

    const tempCanvas = extractFrameCanvas(sourceImg, source, frame)
    if (!tempCanvas) return

    let scaledCanvas = pixelPerfectResize
      ? scaleImageWithPixelSnap(tempCanvas, targetWidth, targetHeight, pixelSnapTargets[frame.sourceIndex])
      : scaleImageNearestNeighbor(tempCanvas, targetWidth, targetHeight)
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
        bgColorSource,
        fillInterior
      )
      scaledCtx.putImageData(processedData, 0, 0)
    }

    if (flipHorizontal) {
      scaledCanvas = flipCanvasHorizontal(scaledCanvas)
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
