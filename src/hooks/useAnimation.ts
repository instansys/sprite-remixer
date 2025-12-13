import { useRef, useEffect, useCallback, useState } from 'react'
import type { FrameData } from '../types'

interface UseAnimationOptions {
  processedImageUrl: string | null
  selectedFrames: FrameData[]
  fps: number
  targetWidth: number
  targetHeight: number
  outputCols: number
}

export function useAnimation({
  processedImageUrl,
  selectedFrames,
  fps,
  targetWidth,
  targetHeight,
  outputCols: outputColsSetting
}: UseAnimationOptions) {
  const [isPlaying, setIsPlaying] = useState(false)
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

      if (selectedFrames.length === 0) return

      const img = new Image()
      img.onload = () => {
        const frameIndex = currentFrame % selectedFrames.length
        // Match the output layout calculation in spriteProcessing.ts
        const outputCols = outputColsSetting > 0 ? outputColsSetting : Math.ceil(Math.sqrt(selectedFrames.length))
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

      setCurrentFrame(prev => (prev + 1) % selectedFrames.length)
      lastFrameTimeRef.current = timestamp
    }

    animationFrameRef.current = requestAnimationFrame(animate)
  }, [isPlaying, processedImageUrl, selectedFrames, fps, currentFrame, outputColsSetting, targetWidth, targetHeight])

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

  const togglePlayback = useCallback(() => {
    setIsPlaying(prev => !prev)
  }, [])

  return {
    isPlaying,
    togglePlayback,
    canvasRef
  }
}
