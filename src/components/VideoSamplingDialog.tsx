import type { FrameSamplingQuality } from '../types'
import { FrameSamplingSelector } from './FrameSamplingSelector'

interface VideoSamplingDialogProps {
  fileName: string
  quality: FrameSamplingQuality
  pendingCount: number
  onChange: (quality: FrameSamplingQuality) => void
  onConfirm: () => void
  onCancel: () => void
}

export function VideoSamplingDialog({
  fileName,
  quality,
  pendingCount,
  onChange,
  onConfirm,
  onCancel
}: VideoSamplingDialogProps) {
  return (
    <div className="source-dialog-overlay">
      <div className="source-dialog">
        <div className="source-dialog-header">
          <h3>動画フレーム分割{pendingCount > 1 && ` (残り${pendingCount}件)`}</h3>
        </div>
        <div className="source-dialog-body">
          <p className="source-dialog-filename">{fileName}</p>
          <FrameSamplingSelector value={quality} onChange={onChange} disabled={false} />
        </div>
        <div className="source-dialog-actions">
          <button className="btn" onClick={onCancel}>
            {pendingCount > 1 ? 'スキップ' : 'キャンセル'}
          </button>
          <button className="btn btn-primary" onClick={onConfirm}>
            処理開始
          </button>
        </div>
      </div>
    </div>
  )
}
