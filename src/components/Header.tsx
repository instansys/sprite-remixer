interface HeaderProps {
  onSaveSettings: () => void
  onLoadSettings: () => void
  onResetSettings: () => void
}

export function Header({ onSaveSettings, onLoadSettings, onResetSettings }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-content">
        <div className="logo">
          <div className="logo-icon">🎮</div>
          <h1>Sprite Remixer</h1>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={onSaveSettings}>
            💾 設定を保存
          </button>
          <input
            type="file"
            accept=".json"
            onChange={(e) => {
              if (e.target.files?.[0]) {
                onLoadSettings()
              }
            }}
            style={{ display: 'none' }}
            id="settings-file-input"
          />
          <button className="btn" onClick={() => document.getElementById('settings-file-input')?.click()}>
            📂 設定を読込
          </button>
          <button className="btn" onClick={onResetSettings}>
            ↺ リセット
          </button>
        </div>
      </div>
    </header>
  )
}
