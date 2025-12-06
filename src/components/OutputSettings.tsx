import { NumberInput } from '../NumberInput'

interface OutputSettingsProps {
  targetWidth: number
  targetHeight: number
  lockAspectRatio: boolean
  onWidthChange: (width: number) => void
  onHeightChange: (height: number) => void
  onLockAspectRatioChange: (locked: boolean, currentRatio: number) => void
}

export function OutputSettings({
  targetWidth,
  targetHeight,
  lockAspectRatio,
  onWidthChange,
  onHeightChange,
  onLockAspectRatioChange
}: OutputSettingsProps) {
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
    </div>
  )
}
