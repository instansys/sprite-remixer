import type { RefObject } from 'react'
import type { CropMargins, OutputFormat } from '../types'
import { NumberInput } from '../NumberInput'

interface ResultsPanelProps {
  processedImageUrl: string
  sourceFrameWidth: number
  sourceFrameHeight: number
  croppedFrameWidth: number
  croppedFrameHeight: number
  cropMargins: CropMargins
  isPlaying: boolean
  isReversed: boolean
  fps: number
  outputFormat: OutputFormat
  isEncodingGif: boolean
  animationCanvasRef: RefObject<HTMLCanvasElement | null>
  previewBgColor: string
  onDownload: () => void
  onCropChange: (side: keyof CropMargins, value: number) => void
  onAutoCrop: () => void
  onResetCrop: () => void
  onTogglePlayback: () => void
  onToggleReverse: () => void
  onFpsChange: (fps: number) => void
  onPreviewBgColorChange: (color: string) => void
  isDetectingCrop: boolean
}

export function ResultsPanel({
  processedImageUrl,
  sourceFrameWidth,
  sourceFrameHeight,
  croppedFrameWidth,
  croppedFrameHeight,
  cropMargins,
  isPlaying,
  isReversed,
  fps,
  outputFormat,
  isEncodingGif,
  animationCanvasRef,
  previewBgColor,
  onDownload,
  onCropChange,
  onAutoCrop,
  onResetCrop,
  onTogglePlayback,
  onToggleReverse,
  onFpsChange,
  onPreviewBgColorChange,
  isDetectingCrop
}: ResultsPanelProps) {
  const cropControls: Array<{
    key: keyof CropMargins
    label: string
    max: number
  }> = [
    { key: 'top', label: '上', max: Math.max(0, sourceFrameHeight - cropMargins.bottom - 1) },
    { key: 'right', label: '右', max: Math.max(0, sourceFrameWidth - cropMargins.left - 1) },
    { key: 'bottom', label: '下', max: Math.max(0, sourceFrameHeight - cropMargins.top - 1) },
    { key: 'left', label: '左', max: Math.max(0, sourceFrameWidth - cropMargins.right - 1) }
  ]

  return (
    <div className="results-panel">
      <div className="result-section">
        <h3>📦 変換結果</h3>
        <div className="result-container">
          <img
            src={processedImageUrl}
            alt="Processed sprite sheet"
            className="result-image"
          />
          <button className="download-button" onClick={onDownload} disabled={isEncodingGif}>
            {isEncodingGif
              ? '⏳ GIF エンコード中...'
              : outputFormat === 'gif'
                ? '⬇️ GIF ダウンロード'
                : '⬇️ ダウンロード'
            }
          </button>
        </div>
      </div>

      <div className="animation-preview">
        <h3>▶️ プレビュー</h3>
        <div className="animation-controls">
          <div className="animation-canvas-wrapper" style={{ background: previewBgColor }}>
            <canvas ref={animationCanvasRef} className="animation-canvas" />
          </div>
          <label className="preview-bg-color">
            背景色
            <input
              type="color"
              value={previewBgColor}
              onChange={(e) => onPreviewBgColorChange(e.target.value)}
            />
          </label>
          <div className="animation-buttons">
            <button onClick={onTogglePlayback}>
              {isPlaying ? '⏸ 停止' : '▶ 再生'}
            </button>
            <button onClick={onToggleReverse} className={isReversed ? 'active' : ''}>
              ◀ 逆再生
            </button>
            <label>
              FPS
              <NumberInput
                min={1}
                max={60}
                value={fps}
                onChange={onFpsChange}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="crop-section">
        <h3>✂️ クロップ</h3>
        <div className="crop-body">
          <div className="crop-summary">
            <span>出力サイズ</span>
            <strong>{croppedFrameWidth} × {croppedFrameHeight}px</strong>
          </div>
          <div className="crop-actions">
            <button onClick={onAutoCrop} disabled={isDetectingCrop}>
              {isDetectingCrop ? '検出中...' : '透明余白を自動検出'}
            </button>
            <button onClick={onResetCrop}>クロップ解除</button>
          </div>
          <div className="crop-controls">
            {cropControls.map(({ key, label, max }) => (
              <label key={key} className="crop-control">
                <span>{label}</span>
                <input
                  type="range"
                  min={0}
                  max={max}
                  value={cropMargins[key]}
                  onChange={(e) => onCropChange(key, Number(e.target.value))}
                />
                <NumberInput
                  min={0}
                  max={max}
                  value={cropMargins[key]}
                  onChange={(value) => onCropChange(key, value)}
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
