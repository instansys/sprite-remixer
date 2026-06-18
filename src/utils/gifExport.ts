import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import type { FrameData, SourceImage } from '../types'
import type { BackgroundColorSource } from '../imageProcessing'
import {
  scaleImageNearestNeighbor,
  scaleImageWithPixelSnap,
  removeBackgroundFromImage,
  flipCanvasHorizontal
} from '../imageProcessing'
import { buildStablePixelSnapTargets, extractFrameCanvas } from './pixelSnapTargets'

interface GifExportOptions {
  sourceImages: SourceImage[]
  selectedFrames: FrameData[]
  targetWidth: number
  targetHeight: number
  fps: number
  removeBackground: boolean
  backgroundTolerance: number
  edgeErosion: number
  bgColorSource: BackgroundColorSource
  fillInterior: boolean
  pixelPerfectResize: boolean
  flipHorizontal: boolean
  onProgress?: (current: number, total: number) => void
}

export async function exportAnimatedGif(options: GifExportOptions): Promise<string | null> {
  const {
    sourceImages,
    selectedFrames,
    targetWidth,
    targetHeight,
    fps,
    removeBackground,
    backgroundTolerance,
    edgeErosion,
    bgColorSource,
    fillInterior,
    pixelPerfectResize,
    flipHorizontal,
    onProgress
  } = options

  if (sourceImages.length === 0 || selectedFrames.length === 0) {
    return null
  }

  // Load all source images
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

  const gif = GIFEncoder()
  const delay = Math.round(1000 / fps)
  const total = selectedFrames.length
  const pixelSnapTargets = pixelPerfectResize
    ? buildStablePixelSnapTargets(sourceImages, selectedFrames, loadedImages)
    : {}

  for (let i = 0; i < total; i++) {
    const frame = selectedFrames[i]
    const sourceImg = loadedImages[frame.sourceIndex]
    const source = sourceImages[frame.sourceIndex]
    if (!sourceImg || !source) continue

    const tempCanvas = extractFrameCanvas(sourceImg, source, frame)
    if (!tempCanvas) continue

    let scaledCanvas = pixelPerfectResize
      ? scaleImageWithPixelSnap(tempCanvas, targetWidth, targetHeight, pixelSnapTargets[frame.sourceIndex])
      : scaleImageNearestNeighbor(tempCanvas, targetWidth, targetHeight)
    const scaledCtx = scaledCanvas.getContext('2d')
    if (!scaledCtx) continue

    // Optional background removal
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

    // Get pixel data for GIF encoding
    const outputCtx = scaledCanvas.getContext('2d')
    if (!outputCtx) continue
    const imageData = outputCtx.getImageData(0, 0, targetWidth, targetHeight)
    const { data } = imageData

    // Quantize and encode frame
    const hasTransparency = removeBackground
    const palette = quantize(data, 256, {
      format: 'rgb565',
      oneBitAlpha: hasTransparency
    })
    const index = applyPalette(data, palette, 'rgb565')

    // Find transparent index if background was removed
    let transparentIndex: number | undefined
    if (hasTransparency) {
      transparentIndex = palette.findIndex(c => c.length >= 4 && c[3] === 0)
      if (transparentIndex === -1) transparentIndex = undefined
    }

    gif.writeFrame(index, targetWidth, targetHeight, {
      palette,
      delay,
      repeat: 0,
      ...(transparentIndex !== undefined && {
        transparent: true,
        transparentIndex,
        dispose: 2
      })
    })

    onProgress?.(i + 1, total)

    // Yield to event loop every 5 frames
    if (i % 5 === 0) {
      await new Promise(r => setTimeout(r, 0))
    }
  }

  gif.finish()

  const blob = new Blob([gif.bytes()], { type: 'image/gif' })
  return URL.createObjectURL(blob)
}
