import { NumberInput } from '../NumberInput'
import type { BackgroundColorSource } from '../imageProcessing'

interface BackgroundRemovalSettingsProps {
  removeBackground: boolean
  backgroundTolerance: number
  edgeErosion: number
  bgColorSource: BackgroundColorSource
  hasSourceImages: boolean
  onRemoveBackgroundChange: (enabled: boolean) => void
  onToleranceChange: (tolerance: number) => void
  onEdgeErosionChange: (erosion: number) => void
  onBgColorSourceChange: (source: BackgroundColorSource) => void
  onProcess: () => void
}

export function BackgroundRemovalSettings({
  removeBackground,
  backgroundTolerance,
  edgeErosion,
  bgColorSource,
  hasSourceImages,
  onRemoveBackgroundChange,
  onToleranceChange,
  onEdgeErosionChange,
  onBgColorSourceChange,
  onProcess
}: BackgroundRemovalSettingsProps) {
  return (
    <div className="control-group">
      <h3>背景除去</h3>
      <label>
        背景を透過
        <input
          type="checkbox"
          checked={removeBackground}
          onChange={(e) => onRemoveBackgroundChange(e.target.checked)}
        />
      </label>
      {removeBackground && (
        <>
          <label>
            検出位置
            <select
              value={bgColorSource}
              onChange={(e) => onBgColorSourceChange(e.target.value as BackgroundColorSource)}
            >
              <option value="auto">自動</option>
              <option value="top-left">左上</option>
              <option value="top-right">右上</option>
              <option value="bottom-left">左下</option>
              <option value="bottom-right">右下</option>
            </select>
          </label>
          <label>
            許容値
            <NumberInput
              min={0}
              max={255}
              value={backgroundTolerance}
              onChange={onToleranceChange}
            />
          </label>
          <label>
            侵食 (px)
            <NumberInput
              min={0}
              max={10}
              value={edgeErosion}
              onChange={onEdgeErosionChange}
            />
          </label>
        </>
      )}
      <button
        className="process-button"
        onClick={onProcess}
        disabled={!hasSourceImages}
      >
        ✨ 変換実行
      </button>
    </div>
  )
}
