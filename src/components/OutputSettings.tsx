import type { OutputFormat, ResolutionRecommendation } from '../types'
import { NumberInput } from '../NumberInput'

interface OutputSettingsProps {
  targetWidth: number
  targetHeight: number
  lockAspectRatio: boolean
  outputCols: number
  outputFormat: OutputFormat
  pixelPerfectResize: boolean
  flipHorizontal: boolean
  resolutionRecommendations: ResolutionRecommendation[]
  selectedFrameCount: number
  onWidthChange: (width: number) => void
  onHeightChange: (height: number) => void
  onLockAspectRatioChange: (locked: boolean, currentRatio: number) => void
  onOutputColsChange: (cols: number) => void
  onOutputFormatChange: (format: OutputFormat) => void
  onPixelPerfectResizeChange: (enabled: boolean) => void
  onFlipHorizontalChange: (enabled: boolean) => void
}

export function OutputSettings({
  targetWidth,
  targetHeight,
  lockAspectRatio,
  outputCols,
  outputFormat,
  pixelPerfectResize,
  flipHorizontal,
  resolutionRecommendations,
  selectedFrameCount,
  onWidthChange,
  onHeightChange,
  onLockAspectRatioChange,
  onOutputColsChange,
  onOutputFormatChange,
  onPixelPerfectResizeChange,
  onFlipHorizontalChange
}: OutputSettingsProps) {
  // Calculate actual cols/rows for the sprite sheet
  const actualCols = outputCols > 0 ? outputCols : Math.ceil(Math.sqrt(selectedFrameCount))
  const actualRows = selectedFrameCount > 0 ? Math.ceil(selectedFrameCount / actualCols) : 0
  const sheetWidth = actualCols * targetWidth
  const sheetHeight = actualRows * targetHeight

  return (
    <div className="control-group">
      <h3>出力設定</h3>
      <label>
        ドット保持リサイズ
        <input
          type="checkbox"
          checked={pixelPerfectResize}
          onChange={(e) => onPixelPerfectResizeChange(e.target.checked)}
        />
      </label>
      <label>
        左右反転
        <input
          type="checkbox"
          checked={flipHorizontal}
          onChange={(e) => onFlipHorizontalChange(e.target.checked)}
        />
      </label>
      <label>
        アスペクト比固定
        <input
          type="checkbox"
          checked={lockAspectRatio}
          onChange={(e) => {
            const ratio = targetWidth > 0 ? targetHeight / targetWidth : 1
            onLockAspectRatioChange(e.target.checked, ratio)
          }}
        />
      </label>
      <label>
        出力幅 (px)
        <NumberInput
          min={8}
          value={targetWidth}
          onChange={onWidthChange}
        />
      </label>
      <label>
        出力高さ (px)
        <NumberInput
          key={lockAspectRatio ? `locked-${targetHeight}` : 'unlocked'}
          min={8}
          value={targetHeight}
          onChange={onHeightChange}
          disabled={lockAspectRatio}
        />
      </label>
      {pixelPerfectResize && resolutionRecommendations.length > 0 && (
        <div className="resolution-recommendations">
          <div className="recommendation-title">おすすめ解像度</div>
          <div className="recommendation-options">
            {resolutionRecommendations.map((recommendation) => {
              const selected = recommendation.width === targetWidth && recommendation.height === targetHeight
              return (
                <button
                  key={`${recommendation.width}x${recommendation.height}`}
                  type="button"
                  className={`recommendation-option ${selected ? 'selected' : ''}`}
                  onClick={() => {
                    onWidthChange(recommendation.width)
                    onHeightChange(recommendation.height)
                  }}
                  title={`論理解像度 ${recommendation.logicalWidth} x ${recommendation.logicalHeight} の ${recommendation.scale} 倍`}
                >
                  <span>{recommendation.label}</span>
                  <strong>{recommendation.width} x {recommendation.height}</strong>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {outputFormat !== 'gif' && (
        <label>
          横に並べる数
          <NumberInput
            min={0}
            value={outputCols}
            onChange={onOutputColsChange}
          />
          <span className="hint">0 = 自動</span>
        </label>
      )}
      <label>
        出力形式
        <div className="format-selector">
          <button
            type="button"
            className={`format-option ${outputFormat === 'png' ? 'selected' : ''}`}
            onClick={() => onOutputFormatChange('png')}
          >
            PNG
          </button>
          <button
            type="button"
            className={`format-option ${outputFormat === 'webp' ? 'selected' : ''}`}
            onClick={() => onOutputFormatChange('webp')}
          >
            WebP
          </button>
          <button
            type="button"
            className={`format-option ${outputFormat === 'gif' ? 'selected' : ''}`}
            onClick={() => onOutputFormatChange('gif')}
          >
            GIF
          </button>
        </div>
      </label>
      {selectedFrameCount > 0 && (
        <div className="sheet-size-info">
          {outputFormat === 'gif'
            ? `アニメーション GIF: ${selectedFrameCount} フレーム (${targetWidth} x ${targetHeight} px)`
            : `スプライトシート: ${actualCols} x ${actualRows} (${sheetWidth} x ${sheetHeight} px)`
          }
        </div>
      )}
    </div>
  )
}
