import type { AppSettings } from '../types'
import { DEFAULT_SETTINGS } from '../constants'

export function saveSettingsToFile(settings: AppSettings) {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = 'sprite-remixer-settings.json'
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

export function loadSettingsFromFile(file: File): Promise<Partial<AppSettings>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const settings = JSON.parse(event.target?.result as string)
        resolve(settings)
      } catch (error) {
        reject(error)
      }
    }
    reader.onerror = reject
    reader.readAsText(file)
  })
}

export function getDefaultSettings(): AppSettings {
  return {
    srcCols: DEFAULT_SETTINGS.srcCols,
    srcRows: DEFAULT_SETTINGS.srcRows,
    targetWidth: DEFAULT_SETTINGS.targetWidth,
    targetHeight: DEFAULT_SETTINGS.targetHeight,
    fps: DEFAULT_SETTINGS.fps
  }
}
