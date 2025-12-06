import { useState, useCallback } from 'react'
import type { SourceImage } from '../types'

export function useSourceImages() {
  const [sourceImages, setSourceImages] = useState<SourceImage[]>([])

  const addSource = useCallback((source: SourceImage) => {
    setSourceImages(prev => [...prev, source])
  }, [])

  const updateSourceSettings = useCallback((sourceId: string, cols: number, rows: number) => {
    setSourceImages(prev => prev.map(source =>
      source.id === sourceId ? { ...source, cols, rows } : source
    ))
  }, [])

  const removeSource = useCallback((sourceId: string) => {
    setSourceImages(prev => prev.filter(source => source.id !== sourceId))
  }, [])

  const generateSourceId = useCallback(() => {
    return `source-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
  }, [])

  return {
    sourceImages,
    addSource,
    updateSourceSettings,
    removeSource,
    generateSourceId
  }
}
