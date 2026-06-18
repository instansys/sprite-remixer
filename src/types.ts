export interface FrameData {
  index: number // グローバルインデックス（全フレーム通し番号）
  localIndex: number // ソース内でのインデックス
  x: number
  y: number
  width: number
  height: number
  selected: boolean
  sourceIndex: number // どのソース画像からのフレームか
}

export type SourceType = 'image' | 'video' | 'gif'

export interface SourceImage {
  id: string
  name: string
  imageUrl: string
  cols: number
  rows: number
  sourceType: SourceType
  // 元シート画像の自然寸法（1フレームあたりの出力pxの導出に使用）
  naturalWidth?: number
  naturalHeight?: number
}

export interface PendingImage {
  file: File
  imageUrl: string
  // 自動検出された分割数（ダイアログの初期値に使用、未検出時はundefined）
  detectedCols?: number
  detectedRows?: number
}

export type FrameSamplingQuality = 'low' | 'medium' | 'high' | 'ultra' | 'all'

export type OutputFormat = 'png' | 'webp' | 'gif'

export interface ResolutionRecommendation {
  label: string
  width: number
  height: number
  scale: number
  logicalWidth: number
  logicalHeight: number
}

export interface SamplingConfig {
  label: string
  sampleInterval: number
  maxFrames: number | null
}

export interface VideoProgress {
  current: number
  total: number
}

export interface AppSettings {
  srcCols: number
  srcRows: number
  targetWidth: number
  targetHeight: number
  pixelPerfectResize: boolean
  flipHorizontal: boolean
  fps: number
}
