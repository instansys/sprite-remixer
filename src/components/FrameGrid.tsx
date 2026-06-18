import { memo } from 'react'
import type { FrameData, SourceImage } from '../types'
import type { SourceThumbnail } from '../hooks'
import { useSourceThumbnails } from '../hooks'
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

interface SpriteFrameProps {
  index: number
  localIndex: number
  x: number
  y: number
  cols: number
  rows: number
  selected: boolean
  thumbnailUrl: string | undefined
  onToggle: (index: number) => void
}

// 1タイル分のコンポーネント。memo化することで、あるフレームをトグルしても
// 他の数十枚のタイルが再レンダリングされず、選択操作が軽くなる。
const SpriteFrame = memo(function SpriteFrame({
  index,
  localIndex,
  x,
  y,
  cols,
  rows,
  selected,
  thumbnailUrl,
  onToggle
}: SpriteFrameProps) {
  return (
    <div
      className={`sprite-frame ${selected ? 'selected' : ''}`}
      onClick={() => onToggle(index)}
    >
      <div
        className="sprite-frame-content"
        style={{
          backgroundImage: thumbnailUrl ? `url(${thumbnailUrl})` : undefined,
          backgroundSize: `${cols * 100}% ${rows * 100}%`,
          backgroundPosition: `${-x * 100}% ${-y * 100}%`,
        }}
      />
      <div className="frame-number">{localIndex + 1}</div>
    </div>
  )
})

// 1フレームの縦横比 = (シート幅 / cols) / (シート高 / rows)。
// 実寸が取れない間はcols/rowsからの近似で代用する。
function frameAspectRatio(source: SourceImage, thumb: SourceThumbnail | undefined): string {
  if (thumb) {
    const w = thumb.naturalWidth / source.cols
    const h = thumb.naturalHeight / source.rows
    if (w > 0 && h > 0) return `${w} / ${h}`
  }
  return `${source.cols} / ${source.rows}`
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
  const thumbnails = useSourceThumbnails(sourceImages)

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
            const thumb = thumbnails.get(source.id)
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
                <div
                  className="sprite-grid"
                  style={{ '--frame-aspect-ratio': frameAspectRatio(source, thumb) } as React.CSSProperties}
                >
                  {sourceFrames.map((frame) => (
                    <SpriteFrame
                      key={frame.index}
                      index={frame.index}
                      localIndex={frame.localIndex}
                      x={frame.x}
                      y={frame.y}
                      cols={source.cols}
                      rows={source.rows}
                      selected={frame.selected}
                      thumbnailUrl={thumb?.url}
                      onToggle={onToggleFrame}
                    />
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
