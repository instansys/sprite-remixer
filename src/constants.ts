import type { FrameSamplingQuality, OutputFormat, SamplingConfig } from './types'

export const SAMPLING_CONFIGS: Record<FrameSamplingQuality, SamplingConfig> = {
  low: { label: '低 (軽い)', sampleInterval: 15, maxFrames: 30 },
  medium: { label: '中 (標準)', sampleInterval: 10, maxFrames: 50 },
  high: { label: '高 (詳細)', sampleInterval: 5, maxFrames: 100 },
  ultra: { label: '最高 (全)', sampleInterval: 2, maxFrames: 200 }
}

export const STORAGE_KEYS = {
  srcCols: 'sprite-remixer-src-cols',
  srcRows: 'sprite-remixer-src-rows',
  targetWidth: 'sprite-remixer-target-width',
  targetHeight: 'sprite-remixer-target-height',
  outputCols: 'sprite-remixer-output-cols',
  outputFormat: 'sprite-remixer-output-format',
  fps: 'sprite-remixer-fps',
  frameSamplingQuality: 'sprite-remixer-frame-sampling-quality'
} as const

export const DEFAULT_SETTINGS = {
  srcCols: 8,
  srcRows: 4,
  targetWidth: 32,
  targetHeight: 32,
  outputCols: 0, // 0 = auto
  outputFormat: 'webp' as OutputFormat,
  fps: 12,
  frameSamplingQuality: 'medium' as FrameSamplingQuality
} as const
