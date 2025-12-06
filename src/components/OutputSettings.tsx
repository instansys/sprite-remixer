import type { OutputFormat } from '../types'
import { NumberInput } from '../NumberInput'

interface OutputSettingsProps {
  targetWidth: number
  targetHeight: number
  lockAspectRatio: boolean
  outputCols: number
  outputFormat: OutputFormat
  selectedFrameCount: number
  onWidthChange: (width: number) => void
  onHeightChange: (height: number) => void
  onLockAspectRatioChange: (locked: boolean, currentRatio: number) => void
  onOutputColsChange: (cols: number) => void
  onOutputFormatChange: (format: OutputFormat) => void
}

export function OutputSettings({
  targetWidth,
  targetHeight,
  lockAspectRatio,
  outputCols,
  outputFormat,
  selectedFrameCount,
  onWidthChange,
  onHeightChange,
  onLockAspectRatioChange,
  onOutputColsChange,
  onOutputFormatChange
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
      <label>
        横に並べる数
        <NumberInput
          min={0}
          value={outputCols}
          onChange={onOutputColsChange}
        />
        <span className="hint">0 = 自動</span>
      </label>
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
        </div>
      </label>
      {selectedFrameCount > 0 && (
        <div className="sheet-size-info">
          スプライトシート: {actualCols} x {actualRows} ({sheetWidth} x {sheetHeight} px)
        </div>
      )}
    </div>
  )
}
