import { useRef, useEffect, useCallback, useState } from 'react'
import { resolveSpriteSheetOutputCols } from '../utils/crop'

interface UseAnimationOptions {
  processedImageUrl: string | null
  frameCount: number
  fps: number
  targetWidth: number
  targetHeight: number
  outputCols: number
}

export function useAnimation({
  processedImageUrl,
  frameCount,
  fps,
  targetWidth,
  targetHeight,
  outputCols: outputColsSetting
}: UseAnimationOptions) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isReversed, setIsReversed] = useState(false)
  const [currentFrame, setCurrentFrame] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number>(0)
  const lastFrameTimeRef = useRef<number>(0)

  const animate = useCallback((timestamp: number) => {
    if (!isPlaying || !processedImageUrl || !canvasRef.current) return

    const elapsed = timestamp - lastFrameTimeRef.current
    const frameInterval = 1000 / fps

    if (elapsed > frameInterval) {
      const ctx = canvasRef.current.getContext('2d')
      if (!ctx) return

      if (frameCount === 0) return

      const img = new Image()
      img.onload = () => {
        const frameIndex = currentFrame % frameCount
        // Match the output layout calculation in spriteProcessing.ts
        const outputCols = resolveSpriteSheetOutputCols(outputColsSetting, frameCount)
        const col = frameIndex % outputCols
        const row = Math.floor(frameIndex / outputCols)

        ctx.clearRect(0, 0, targetWidth, targetHeight)
        ctx.drawImage(
          img,
          col * targetWidth,
          row * targetHeight,
          targetWidth,
          targetHeight,
          0,
          0,
          targetWidth,
          targetHeight
        )
      }
      img.src = processedImageUrl

      setCurrentFrame(prev => {
        if (isReversed) {
          return (prev - 1 + frameCount) % frameCount
        }
        return (prev + 1) % frameCount
      })
      lastFrameTimeRef.current = timestamp
    }

    animationFrameRef.current = requestAnimationFrame(animate)
  }, [isPlaying, isReversed, processedImageUrl, frameCount, fps, currentFrame, outputColsSetting, targetWidth, targetHeight])

  useEffect(() => {
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(animate)
    } else if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isPlaying, animate])

  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.width = targetWidth
      canvasRef.current.height = targetHeight
    }
  }, [targetWidth, targetHeight])

  // Draw the first frame when processedImageUrl changes or settings change
  useEffect(() => {
    if (!processedImageUrl || !canvasRef.current || frameCount === 0) return

    const canvas = canvasRef.current
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      // Draw first frame (position 0, 0 in the sprite sheet)
      ctx.clearRect(0, 0, targetWidth, targetHeight)
      ctx.drawImage(
        img,
        0,
        0,
        targetWidth,
        targetHeight,
        0,
        0,
        targetWidth,
        targetHeight
      )
    }
    img.src = processedImageUrl

    // Reset frame counter
    setCurrentFrame(0)
  }, [processedImageUrl, targetWidth, targetHeight, frameCount, outputColsSetting])

  const togglePlayback = useCallback(() => {
    setIsPlaying(prev => !prev)
  }, [])

  const toggleReverse = useCallback(() => {
    setIsReversed(prev => !prev)
  }, [])

  return {
    isPlaying,
    isReversed,
    togglePlayback,
    toggleReverse,
    canvasRef
  }
}
