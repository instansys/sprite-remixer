import { useState, useCallback, useEffect } from 'react'
import type { FrameData, SourceImage } from '../types'

export function useFrameSelection(sourceImages: SourceImage[]) {
  const [frames, setFrames] = useState<FrameData[]>([])
  const [isGeneratingFrames, setIsGeneratingFrames] = useState(false)

  const generateAllFrames = useCallback(async () => {
    setIsGeneratingFrames(true)

    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))

    const newFrames: FrameData[] = []
    let globalIndex = 0

    for (let sourceIndex = 0; sourceIndex < sourceImages.length; sourceIndex++) {
      const source = sourceImages[sourceIndex]
      const frameCount = source.cols * source.rows

      for (let localIndex = 0; localIndex < frameCount; localIndex++) {
        const col = localIndex % source.cols
        const row = Math.floor(localIndex / source.cols)

        newFrames.push({
          index: globalIndex,
          localIndex,
          x: col,
          y: row,
          width: source.cols,
          height: source.rows,
          selected: false,
          sourceIndex
        })
        globalIndex++

        if (globalIndex % 100 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }
    }

    setFrames(newFrames)
    setIsGeneratingFrames(false)
  }, [sourceImages])

  useEffect(() => {
    generateAllFrames()
  }, [generateAllFrames])

  const toggleFrame = useCallback((index: number) => {
    setFrames(prev => prev.map(frame =>
      frame.index === index ? { ...frame, selected: !frame.selected } : frame
    ))
  }, [])

  const selectAll = useCallback(() => {
    setFrames(prev => prev.map(frame => ({ ...frame, selected: true })))
  }, [])

  const deselectAll = useCallback(() => {
    setFrames(prev => prev.map(frame => ({ ...frame, selected: false })))
  }, [])

  const selectedFrames = frames.filter(f => f.selected)

  return {
    frames,
    isGeneratingFrames,
    toggleFrame,
    selectAll,
    deselectAll,
    selectedFrames,
    selectedCount: selectedFrames.length,
    totalCount: frames.length
  }
}
