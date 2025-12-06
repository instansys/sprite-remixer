import type { VideoProgress } from '../types'

interface VideoProgressModalProps {
  progress: VideoProgress
}

export function VideoProgressModal({ progress }: VideoProgressModalProps) {
  return (
    <div className="video-progress">
      <div className="progress-content">
        <p>処理中...</p>
        <progress value={progress.current} max={progress.total} />
        <p>{progress.current} / {progress.total} フレーム</p>
      </div>
    </div>
  )
}
