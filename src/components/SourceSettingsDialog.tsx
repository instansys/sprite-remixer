import type { PendingImage } from '../types'
import { NumberInput } from '../NumberInput'

interface SourceSettingsDialogProps {
  pendingImage: PendingImage
  dialogCols: number
  dialogRows: number
  isProcessing: boolean
  pendingCount?: number
  onColsChange: (cols: number) => void
  onRowsChange: (rows: number) => void
  onConfirm: () => void
  onCancel: () => void
}

export function SourceSettingsDialog({
  pendingImage,
  dialogCols,
  dialogRows,
  isProcessing,
  pendingCount = 1,
  onColsChange,
  onRowsChange,
  onConfirm,
  onCancel
}: SourceSettingsDialogProps) {
  return (
    <div className="source-dialog-overlay">
      <div className="source-dialog">
        <div className="source-dialog-header">
          <h3>ソース設定{pendingCount > 1 && ` (残り${pendingCount}枚)`}</h3>
        </div>
        {isProcessing ? (
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>フレームを生成中...</p>
          </div>
        ) : (
          <>
            <div className="source-dialog-preview">
              <img src={pendingImage.imageUrl} alt="プレビュー" />
            </div>
            <div className="source-dialog-body">
              <p className="source-dialog-filename">{pendingImage.file.name}</p>
              <label>
                横のフレーム数
                <NumberInput
                  min={1}
                  value={dialogCols}
                  onChange={onColsChange}
                />
              </label>
              <label>
                縦のフレーム数
                <NumberInput
                  min={1}
                  value={dialogRows}
                  onChange={onRowsChange}
                />
              </label>
            </div>
            <div className="source-dialog-actions">
              <button className="btn" onClick={onCancel}>
                {pendingCount > 1 ? 'スキップ' : 'キャンセル'}
              </button>
              <button className="btn btn-primary" onClick={onConfirm}>
                追加
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
