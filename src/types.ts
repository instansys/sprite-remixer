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
}

export interface PendingImage {
  file: File
  imageUrl: string
  // 自動検出された分割数（ダイアログの初期値に使用、未検出時はundefined）
  detectedCols?: number
  detectedRows?: number
}

export type FrameSamplingQuality = 'low' | 'medium' | 'high' | 'ultra'

export type OutputFormat = 'png' | 'webp' | 'gif'

export interface SamplingConfig {
  label: string
  sampleInterval: number
  maxFrames: number
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
  fps: number
}
