import type { FrameSamplingQuality } from '../types'
import { SAMPLING_CONFIGS } from '../constants'

interface FrameSamplingSelectorProps {
  value: FrameSamplingQuality
  onChange: (quality: FrameSamplingQuality) => void
  disabled: boolean
}

export function FrameSamplingSelector({ value, onChange, disabled }: FrameSamplingSelectorProps) {
  return (
    <div className="control-group">
      <h3>動画/GIF フレーム分割</h3>
      <div className="button-group">
        {(Object.keys(SAMPLING_CONFIGS) as FrameSamplingQuality[]).map((quality) => (
          <button
            key={quality}
            className={`button-group-option ${value === quality ? 'selected' : ''}`}
            onClick={() => onChange(quality)}
            disabled={disabled}
          >
            {SAMPLING_CONFIGS[quality].label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem', marginBottom: 0 }}>
        {SAMPLING_CONFIGS[value].sampleInterval}フレームごとにサンプリング (最大{SAMPLING_CONFIGS[value].maxFrames}フレーム)
      </p>
      {(value === 'high' || value === 'ultra') && (
        <div className="quality-warning">
          <span className="quality-warning-icon">⚠️</span>
          <span>
            480p以上の高解像度動画では処理負荷が高くなります。フレーム数が多い場合、ブラウザが応答しなくなる可能性があります。
          </span>
        </div>
      )}
    </div>
  )
}
