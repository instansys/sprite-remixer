import { decompressFrames, parseGIF } from 'gifuct-js'
import type { FrameSamplingQuality, VideoProgress } from '../types'
import { SAMPLING_CONFIGS } from '../constants'
import { exportCanvasAsPNG } from '../imageProcessing'

export function isCanvasEmpty(canvas: HTMLCanvasElement, threshold: number = 0.01): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return true

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  let opaquePixels = 0
  const totalPixels = canvas.width * canvas.height

  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 10) {
      opaquePixels++
    }
  }

  return (opaquePixels / totalPixels) < threshold
}

export async function extractVideoFrames(
  file: File,
  quality: FrameSamplingQuality,
  onProgress: (progress: VideoProgress) => void
): Promise<{ frames: string[]; width: number; height: number }> {
  const videoUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = videoUrl
  video.muted = true

  await new Promise((resolve) => {
    video.addEventListener('loadedmetadata', resolve, { once: true })
  })

  const duration = video.duration
  const fps = 30
  const totalFrames = Math.floor(duration * fps)

  const samplingConfig = SAMPLING_CONFIGS[quality]
  const sampleInterval = samplingConfig.sampleInterval
  const samplesToTake = Math.min(Math.floor(totalFrames / sampleInterval), samplingConfig.maxFrames)

  onProgress({ current: 0, total: samplesToTake })

  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' })
  if (!ctx) {
    URL.revokeObjectURL(videoUrl)
    return { frames: [], width: 0, height: 0 }
  }

  ctx.imageSmoothingEnabled = false

  const extractedFrames: string[] = []
  const BATCH_SIZE = 5

  for (let batchStart = 0; batchStart < samplesToTake; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, samplesToTake)

    for (let i = batchStart; i < batchEnd; i++) {
      const time = (i * sampleInterval) / fps
      video.currentTime = time

      await new Promise((resolve) => {
        video.addEventListener('seeked', resolve, { once: true })
      })

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      extractedFrames.push(exportCanvasAsPNG(canvas))

      onProgress({ current: i + 1, total: samplesToTake })
    }

    await new Promise(resolve => setTimeout(resolve, 0))
  }

  URL.revokeObjectURL(videoUrl)
  return { frames: extractedFrames, width: video.videoWidth, height: video.videoHeight }
}

export async function extractGifFrames(
  file: File,
  onProgress: (progress: VideoProgress) => void
): Promise<{ frames: string[]; width: number; height: number }> {
  const buffer = await file.arrayBuffer()
  const gif = parseGIF(buffer)
  const gifFrames = decompressFrames(gif, true)

  if (gifFrames.length === 0) {
    return { frames: [], width: 0, height: 0 }
  }

  onProgress({ current: 0, total: gifFrames.length })

  const frameWidth = gifFrames[0].dims.width
  const frameHeight = gifFrames[0].dims.height

  const canvas = document.createElement('canvas')
  canvas.width = frameWidth
  canvas.height = frameHeight
  const ctx = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' })
  if (!ctx) {
    return { frames: [], width: 0, height: 0 }
  }

  ctx.imageSmoothingEnabled = false

  const prevCanvas = document.createElement('canvas')
  prevCanvas.width = frameWidth
  prevCanvas.height = frameHeight
  const prevCtx = prevCanvas.getContext('2d', { alpha: true, colorSpace: 'srgb' })
  if (!prevCtx) {
    return { frames: [], width: 0, height: 0 }
  }
  prevCtx.imageSmoothingEnabled = false

  const extractedFrames: string[] = []
  const BATCH_SIZE = 10

  for (let batchStart = 0; batchStart < gifFrames.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, gifFrames.length)

    for (let i = batchStart; i < batchEnd; i++) {
      const frame = gifFrames[i]

      if (frame.disposalType === 3) {
        prevCtx.clearRect(0, 0, frameWidth, frameHeight)
        prevCtx.drawImage(canvas, 0, 0)
      }

      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = frame.dims.width
      tempCanvas.height = frame.dims.height
      const tempCtx = tempCanvas.getContext('2d', { alpha: true, colorSpace: 'srgb' })
      if (!tempCtx) continue

      tempCtx.imageSmoothingEnabled = false

      const imageData = new ImageData(
        new Uint8ClampedArray(frame.patch),
        frame.dims.width,
        frame.dims.height
      )

      tempCtx.putImageData(imageData, 0, 0)

      ctx.drawImage(
        tempCanvas,
        0, 0, frame.dims.width, frame.dims.height,
        frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height
      )

      if (!isCanvasEmpty(canvas)) {
        extractedFrames.push(exportCanvasAsPNG(canvas))
      }

      if (frame.disposalType === 2) {
        ctx.clearRect(
          frame.dims.left,
          frame.dims.top,
          frame.dims.width,
          frame.dims.height
        )
      } else if (frame.disposalType === 3) {
        ctx.clearRect(0, 0, frameWidth, frameHeight)
        ctx.drawImage(prevCanvas, 0, 0)
      }

      onProgress({ current: i + 1, total: gifFrames.length })
    }

    await new Promise(resolve => setTimeout(resolve, 0))
  }

  return { frames: extractedFrames, width: frameWidth, height: frameHeight }
}

export async function createSpriteSheet(
  extractedFrames: string[],
  frameWidth: number,
  frameHeight: number
): Promise<{ imageUrl: string; cols: number; rows: number }> {
  const cols = Math.ceil(Math.sqrt(extractedFrames.length))
  const rows = Math.ceil(extractedFrames.length / cols)

  const spriteCanvas = document.createElement('canvas')
  spriteCanvas.width = frameWidth * cols
  spriteCanvas.height = frameHeight * rows
  const spriteCtx = spriteCanvas.getContext('2d', { alpha: true, colorSpace: 'srgb' })
  if (!spriteCtx) {
    throw new Error('Failed to create sprite sheet context')
  }

  spriteCtx.imageSmoothingEnabled = false

  const BATCH_SIZE = 10
  for (let batchStart = 0; batchStart < extractedFrames.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, extractedFrames.length)

    await Promise.all(
      extractedFrames.slice(batchStart, batchEnd).map(async (frameSrc, idx) => {
        const i = batchStart + idx
        const img = new Image()
        img.src = frameSrc
        await new Promise((resolve) => {
          img.onload = resolve
        })

        const col = i % cols
        const row = Math.floor(i / cols)
        spriteCtx.drawImage(
          img,
          col * frameWidth,
          row * frameHeight,
          frameWidth,
          frameHeight
        )
      })
    )

    await new Promise(resolve => setTimeout(resolve, 0))
  }

  return {
    imageUrl: exportCanvasAsPNG(spriteCanvas),
    cols,
    rows
  }
}
