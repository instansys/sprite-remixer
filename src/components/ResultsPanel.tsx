import type { RefObject } from 'react'
import type { OutputFormat } from '../types'
import { NumberInput } from '../NumberInput'

interface ResultsPanelProps {
  processedImageUrl: string
  isPlaying: boolean
  isReversed: boolean
  fps: number
  outputFormat: OutputFormat
  isEncodingGif: boolean
  animationCanvasRef: RefObject<HTMLCanvasElement | null>
  previewBgColor: string
  onDownload: () => void
  onTogglePlayback: () => void
  onToggleReverse: () => void
  onFpsChange: (fps: number) => void
  onPreviewBgColorChange: (color: string) => void
}

export function ResultsPanel({
  processedImageUrl,
  isPlaying,
  isReversed,
  fps,
  outputFormat,
  isEncodingGif,
  animationCanvasRef,
  previewBgColor,
  onDownload,
  onTogglePlayback,
  onToggleReverse,
  onFpsChange,
  onPreviewBgColorChange
}: ResultsPanelProps) {
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
    </div>
  )
}
