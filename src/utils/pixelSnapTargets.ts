import type { FrameData, SourceImage } from '../types'
import type { PixelSnapTarget } from '../imageProcessing'
import { analyzePixelSnapCanvas } from '../imageProcessing'

export function extractFrameCanvas(
  sourceImg: HTMLImageElement,
  source: SourceImage,
  frame: FrameData
): HTMLCanvasElement | null {
  const frameWidth = sourceImg.width / source.cols
  const frameHeight = sourceImg.height / source.rows
  const srcX = frame.x * frameWidth
  const srcY = frame.y * frameHeight

  const canvas = document.createElement('canvas')
  canvas.width = frameWidth
  canvas.height = frameHeight
  const ctx = canvas.getContext('2d', {
    alpha: true,
    colorSpace: 'srgb',
    willReadFrequently: true
  })
  if (!ctx) return null

  ctx.imageSmoothingEnabled = false
  ctx.imageSmoothingQuality = 'low'
  ctx.drawImage(
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

  return canvas
}

function median(values: number[]): number | null {
  const sorted = values
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return null

  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function sampleFrames(frames: FrameData[], maxSamples: number): FrameData[] {
  if (frames.length <= maxSamples) return frames

  const samples: FrameData[] = []
  for (let i = 0; i < maxSamples; i++) {
    const index = Math.round((i * (frames.length - 1)) / (maxSamples - 1))
    samples.push(frames[index])
  }
  return samples
}

export function buildStablePixelSnapTargets(
  sourceImages: SourceImage[],
  selectedFrames: FrameData[],
  loadedImages: Record<number, HTMLImageElement>
): Record<number, PixelSnapTarget> {
  const targets: Record<number, PixelSnapTarget> = {}

  sourceImages.forEach((source, sourceIndex) => {
    const sourceImg = loadedImages[sourceIndex]
    if (!sourceImg) return

    const frames = selectedFrames.filter(frame => frame.sourceIndex === sourceIndex)
    const target = buildStablePixelSnapTargetForSource(source, frames, sourceImg)
    if (target) targets[sourceIndex] = target
  })

  return targets
}

export function buildStablePixelSnapTargetForSource(
  source: SourceImage,
  frames: FrameData[],
  sourceImg: HTMLImageElement
): PixelSnapTarget | null {
  if (frames.length === 0) return null

  const frameWidth = sourceImg.width / source.cols
  const frameHeight = sourceImg.height / source.rows
  const pixelSizes: number[] = []

  for (const frame of sampleFrames(frames, 5)) {
    const canvas = extractFrameCanvas(sourceImg, source, frame)
    if (!canvas) continue

    const analysis = analyzePixelSnapCanvas(canvas)
    if (!analysis.detected) continue

    pixelSizes.push(analysis.pixelSizeX, analysis.pixelSizeY)
  }

  const stablePixelSize = median(pixelSizes)
  if (!stablePixelSize) return null

  return {
    logicalWidth: Math.max(1, Math.round(frameWidth / stablePixelSize)),
    logicalHeight: Math.max(1, Math.round(frameHeight / stablePixelSize))
  }
}
