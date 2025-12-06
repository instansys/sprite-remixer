import type { RefObject } from 'react'
import { NumberInput } from '../NumberInput'

interface ResultsPanelProps {
  processedImageUrl: string
  isPlaying: boolean
  fps: number
  animationCanvasRef: RefObject<HTMLCanvasElement | null>
  onDownload: () => void
  onTogglePlayback: () => void
  onFpsChange: (fps: number) => void
}

export function ResultsPanel({
  processedImageUrl,
  isPlaying,
  fps,
  animationCanvasRef,
  onDownload,
  onTogglePlayback,
  onFpsChange
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
          <button className="download-button" onClick={onDownload}>
            ⬇️ ダウンロード
          </button>
        </div>
      </div>

      <div className="animation-preview">
        <h3>▶️ プレビュー</h3>
        <div className="animation-controls">
          <div className="animation-canvas-wrapper">
            <canvas ref={animationCanvasRef} className="animation-canvas" />
          </div>
          <div className="animation-buttons">
            <button onClick={onTogglePlayback}>
              {isPlaying ? '⏸ 停止' : '▶ 再生'}
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
