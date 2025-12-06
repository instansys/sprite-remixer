import type { FrameData, SourceImage } from '../types'
import { NumberInput } from '../NumberInput'

interface FrameGridProps {
  sourceImages: SourceImage[]
  frames: FrameData[]
  isGeneratingFrames: boolean
  selectedCount: number
  totalCount: number
  onToggleFrame: (index: number) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onUpdateSourceSettings: (sourceId: string, cols: number, rows: number) => void
  onRemoveSource: (sourceId: string) => void
}

export function FrameGrid({
  sourceImages,
  frames,
  isGeneratingFrames,
  selectedCount,
  totalCount,
  onToggleFrame,
  onSelectAll,
  onDeselectAll,
  onUpdateSourceSettings,
  onRemoveSource
}: FrameGridProps) {
  return (
    <div className="card frame-selection-section">
      <div className="card-header">
        <h3>🎞️ フレーム選択</h3>
      </div>
      {isGeneratingFrames ? (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>フレームを生成中...</p>
        </div>
      ) : (
        <>
          <div className="frame-controls">
            <button onClick={onSelectAll}>全選択</button>
            <button onClick={onDeselectAll}>全解除</button>
            <span className="selected-count">
              {selectedCount} / {totalCount} 選択中
            </span>
          </div>

          {sourceImages.map((source, sourceIdx) => {
            const sourceFrames = frames.filter(f => f.sourceIndex === sourceIdx)
            return (
              <div key={source.id} className="source-section">
                <div className="source-header">
                  <span className="source-name">{source.name}</span>
                  <div className="source-controls">
                    {source.sourceType === 'image' && (
                      <>
                        <label>
                          横
                          <NumberInput
                            min={1}
                            value={source.cols}
                            onChange={(cols) => onUpdateSourceSettings(source.id, cols, source.rows)}
                          />
                        </label>
                        <label>
                          縦
                          <NumberInput
                            min={1}
                            value={source.rows}
                            onChange={(rows) => onUpdateSourceSettings(source.id, source.cols, rows)}
                          />
                        </label>
                      </>
                    )}
                    <button
                      className="remove-source-button"
                      onClick={() => onRemoveSource(source.id)}
                      title="この素材を削除"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="sprite-grid" style={{ '--frame-aspect-ratio': `${source.cols} / ${source.rows}` } as React.CSSProperties}>
                  {sourceFrames.map((frame) => (
                    <div
                      key={frame.index}
                      className={`sprite-frame ${frame.selected ? 'selected' : ''}`}
                      onClick={() => onToggleFrame(frame.index)}
                    >
                      <div
                        className="sprite-frame-content"
                        style={{
                          backgroundImage: `url(${source.imageUrl})`,
                          backgroundSize: `${source.cols * 100}% ${source.rows * 100}%`,
                          backgroundPosition: `${-frame.x * 100}% ${-frame.y * 100}%`,
                        }}
                      />
                      <div className="frame-number">{frame.localIndex + 1}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
