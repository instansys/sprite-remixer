import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

interface FrameData {
  index: number
  x: number
  y: number
  width: number
  height: number
  selected: boolean
}

// Local storage keys
const STORAGE_KEYS = {
  srcCols: 'sprite-remixer-src-cols',
  srcRows: 'sprite-remixer-src-rows',
  targetWidth: 'sprite-remixer-target-width',
  targetHeight: 'sprite-remixer-target-height',
  paletteSize: 'sprite-remixer-palette-size',
  enableDithering: 'sprite-remixer-enable-dithering',
  fps: 'sprite-remixer-fps'
}

function App() {
  // Load settings from localStorage or use defaults
  const loadSetting = (key: string, defaultValue: number | boolean) => {
    const stored = localStorage.getItem(key)
    if (stored === null) return defaultValue
    return typeof defaultValue === 'boolean' ? stored === 'true' : parseInt(stored)
  }

  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [frames, setFrames] = useState<FrameData[]>([])
  const [srcCols, setSrcCols] = useState(() => loadSetting(STORAGE_KEYS.srcCols, 8) as number)
  const [srcRows, setSrcRows] = useState(() => loadSetting(STORAGE_KEYS.srcRows, 4) as number)
  const [targetWidth, setTargetWidth] = useState(() => loadSetting(STORAGE_KEYS.targetWidth, 32) as number)
  const [targetHeight, setTargetHeight] = useState(() => loadSetting(STORAGE_KEYS.targetHeight, 32) as number)
  const [paletteSize, setPaletteSize] = useState(() => loadSetting(STORAGE_KEYS.paletteSize, 16) as number)
  const [enableDithering, setEnableDithering] = useState(() => loadSetting(STORAGE_KEYS.enableDithering, true) as boolean)
  const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [fps, setFps] = useState(() => loadSetting(STORAGE_KEYS.fps, 12) as number)
  const [currentFrame, setCurrentFrame] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const animationCanvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number>(0)
  const lastFrameTimeRef = useRef<number>(0)

  // Save settings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.srcCols, srcCols.toString())
  }, [srcCols])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.srcRows, srcRows.toString())
  }, [srcRows])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.targetWidth, targetWidth.toString())
  }, [targetWidth])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.targetHeight, targetHeight.toString())
  }, [targetHeight])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.paletteSize, paletteSize.toString())
  }, [paletteSize])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.enableDithering, enableDithering.toString())
  }, [enableDithering])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.fps, fps.toString())
  }, [fps])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const imageUrl = event.target?.result as string
      setOriginalImage(imageUrl)
      
      // Create image to get dimensions
      const img = new Image()
      img.onload = () => {
        generateFrames(img.width, img.height)
      }
      img.src = imageUrl
    }
    reader.readAsDataURL(file)
  }

  const generateFrames = (imageWidth: number, imageHeight: number) => {
    const frameWidth = imageWidth / srcCols
    const frameHeight = imageHeight / srcRows
    const newFrames: FrameData[] = []

    for (let row = 0; row < srcRows; row++) {
      for (let col = 0; col < srcCols; col++) {
        const index = row * srcCols + col
        newFrames.push({
          index,
          x: col * frameWidth,
          y: row * frameHeight,
          width: frameWidth,
          height: frameHeight,
          selected: false
        })
      }
    }

    setFrames(newFrames)
  }

  const toggleFrame = (index: number) => {
    setFrames(prev => prev.map(frame => 
      frame.index === index ? { ...frame, selected: !frame.selected } : frame
    ))
  }

  const selectAll = () => {
    setFrames(prev => prev.map(frame => ({ ...frame, selected: true })))
  }

  const deselectAll = () => {
    setFrames(prev => prev.map(frame => ({ ...frame, selected: false })))
  }

  const quantizeColor = (r: number, g: number, b: number, palette: number[][]): number[] => {
    let minDistance = Infinity
    let closestColor = [0, 0, 0]

    for (const color of palette) {
      const distance = Math.sqrt(
        Math.pow(r - color[0], 2) +
        Math.pow(g - color[1], 2) +
        Math.pow(b - color[2], 2)
      )
      if (distance < minDistance) {
        minDistance = distance
        closestColor = color
      }
    }

    return closestColor
  }

  const generatePalette = (imageData: ImageData, size: number): number[][] => {
    const pixels: number[][] = []
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (imageData.data[i + 3] > 0) { // Only consider non-transparent pixels
        pixels.push([
          imageData.data[i],
          imageData.data[i + 1],
          imageData.data[i + 2]
        ])
      }
    }

    if (pixels.length === 0) return [[0, 0, 0]]

    const palette: number[][] = []
    const buckets = [pixels]

    while (palette.length < size && buckets.length > 0) {
      const bucket = buckets.shift()!
      if (bucket.length === 0) continue

      if (palette.length + buckets.length + 1 >= size) {
        const avg = [0, 0, 0]
        for (const pixel of bucket) {
          avg[0] += pixel[0]
          avg[1] += pixel[1]
          avg[2] += pixel[2]
        }
        avg[0] = Math.round(avg[0] / bucket.length)
        avg[1] = Math.round(avg[1] / bucket.length)
        avg[2] = Math.round(avg[2] / bucket.length)
        palette.push(avg)
      } else {
        const ranges = [0, 1, 2].map(channel => {
          const values = bucket.map(p => p[channel])
          return Math.max(...values) - Math.min(...values)
        })
        const maxChannel = ranges.indexOf(Math.max(...ranges))

        bucket.sort((a, b) => a[maxChannel] - b[maxChannel])
        const mid = Math.floor(bucket.length / 2)
        buckets.push(bucket.slice(0, mid))
        buckets.push(bucket.slice(mid))
      }
    }

    return palette
  }

  const applyDithering = (
    imageData: ImageData,
    palette: number[][],
    width: number,
    height: number
  ): ImageData => {
    const result = new ImageData(width, height)
    const data = new Uint8ClampedArray(imageData.data)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const oldColor = [data[idx], data[idx + 1], data[idx + 2]]
        const newColor = quantizeColor(oldColor[0], oldColor[1], oldColor[2], palette)

        result.data[idx] = newColor[0]
        result.data[idx + 1] = newColor[1]
        result.data[idx + 2] = newColor[2]
        result.data[idx + 3] = data[idx + 3]

        if (enableDithering && data[idx + 3] > 0) {
          const error = [
            oldColor[0] - newColor[0],
            oldColor[1] - newColor[1],
            oldColor[2] - newColor[2]
          ]

          const distributeError = (dx: number, dy: number, factor: number) => {
            const nx = x + dx
            const ny = y + dy
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nidx = (ny * width + nx) * 4
              if (data[nidx + 3] > 0) {
                data[nidx] = Math.min(255, Math.max(0, data[nidx] + error[0] * factor))
                data[nidx + 1] = Math.min(255, Math.max(0, data[nidx + 1] + error[1] * factor))
                data[nidx + 2] = Math.min(255, Math.max(0, data[nidx + 2] + error[2] * factor))
              }
            }
          }

          distributeError(1, 0, 7/16)
          distributeError(-1, 1, 3/16)
          distributeError(0, 1, 5/16)
          distributeError(1, 1, 1/16)
        }
      }
    }

    return result
  }

  const processSprites = async () => {
    if (!originalImage || frames.length === 0) return

    const selectedFrames = frames.filter(f => f.selected)
    if (selectedFrames.length === 0) return

    const img = new Image()
    img.onload = () => {
      const outputCols = Math.min(selectedFrames.length, srcCols)
      const outputRows = Math.ceil(selectedFrames.length / outputCols)

      const resultCanvas = document.createElement('canvas')
      resultCanvas.width = outputCols * targetWidth
      resultCanvas.height = outputRows * targetHeight
      const ctx = resultCanvas.getContext('2d')
      if (!ctx) return

      selectedFrames.forEach((frame, idx) => {
        const destCol = idx % outputCols
        const destRow = Math.floor(idx / outputCols)

        // Create temporary canvas for processing
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = frame.width
        tempCanvas.height = frame.height
        const tempCtx = tempCanvas.getContext('2d')
        if (!tempCtx) return

        // Draw original frame
        tempCtx.drawImage(
          img,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          0,
          0,
          frame.width,
          frame.height
        )

        // Scale down to target size using nearest neighbor
        const scaledCanvas = document.createElement('canvas')
        scaledCanvas.width = targetWidth
        scaledCanvas.height = targetHeight
        const scaledCtx = scaledCanvas.getContext('2d')
        if (!scaledCtx) return

        scaledCtx.imageSmoothingEnabled = false
        scaledCtx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight)

        // Get image data and apply palette/dithering
        const imageData = scaledCtx.getImageData(0, 0, targetWidth, targetHeight)
        const palette = generatePalette(imageData, paletteSize)
        const processedData = applyDithering(imageData, palette, targetWidth, targetHeight)

        // Put processed data back
        scaledCtx.putImageData(processedData, 0, 0)

        // Draw to result canvas
        ctx.drawImage(
          scaledCanvas,
          0,
          0,
          targetWidth,
          targetHeight,
          destCol * targetWidth,
          destRow * targetHeight,
          targetWidth,
          targetHeight
        )
      })

      setProcessedImageUrl(resultCanvas.toDataURL())
    }
    img.src = originalImage
  }

  const downloadResult = () => {
    if (!processedImageUrl) return

    const link = document.createElement('a')
    link.download = 'sprite-sheet-pixel-art.png'
    link.href = processedImageUrl
    link.click()
  }

  const animate = useCallback((timestamp: number) => {
    if (!isPlaying || !processedImageUrl || !animationCanvasRef.current) return

    const elapsed = timestamp - lastFrameTimeRef.current
    const frameInterval = 1000 / fps

    if (elapsed > frameInterval) {
      const ctx = animationCanvasRef.current.getContext('2d')
      if (!ctx) return

      const selectedFrames = frames.filter(f => f.selected)
      if (selectedFrames.length === 0) return

      const img = new Image()
      img.onload = () => {
        const frameIndex = currentFrame % selectedFrames.length
        const outputCols = Math.min(selectedFrames.length, srcCols)
        const col = frameIndex % outputCols
        const row = Math.floor(frameIndex / outputCols)

        ctx.clearRect(0, 0, targetWidth, targetHeight)
        ctx.drawImage(
          img,
          col * targetWidth,
          row * targetHeight,
          targetWidth,
          targetHeight,
          0,
          0,
          targetWidth,
          targetHeight
        )
      }
      img.src = processedImageUrl

      setCurrentFrame(prev => (prev + 1) % selectedFrames.length)
      lastFrameTimeRef.current = timestamp
    }

    animationFrameRef.current = requestAnimationFrame(animate)
  }, [isPlaying, processedImageUrl, frames, fps, currentFrame, srcCols, targetWidth, targetHeight])

  useEffect(() => {
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(animate)
    } else if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isPlaying, animate])

  useEffect(() => {
    if (originalImage) {
      const img = new Image()
      img.onload = () => {
        generateFrames(img.width, img.height)
      }
      img.src = originalImage
    }
  }, [srcCols, srcRows, originalImage])

  useEffect(() => {
    if (animationCanvasRef.current) {
      animationCanvasRef.current.width = targetWidth
      animationCanvasRef.current.height = targetHeight
    }
  }, [targetWidth, targetHeight])

  const saveAllSettings = () => {
    const settings = {
      srcCols,
      srcRows,
      targetWidth,
      targetHeight,
      paletteSize,
      enableDithering,
      fps
    }
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.download = 'sprite-remixer-settings.json'
    link.href = url
    link.click()
    URL.revokeObjectURL(url)
  }

  const loadSettingsFromFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const settings = JSON.parse(event.target?.result as string)
        if (settings.srcCols) setSrcCols(settings.srcCols)
        if (settings.srcRows) setSrcRows(settings.srcRows)
        if (settings.targetWidth) setTargetWidth(settings.targetWidth)
        if (settings.targetHeight) setTargetHeight(settings.targetHeight)
        if (settings.paletteSize) setPaletteSize(settings.paletteSize)
        if (settings.enableDithering !== undefined) setEnableDithering(settings.enableDithering)
        if (settings.fps) setFps(settings.fps)
      } catch (error) {
        console.error('Failed to load settings:', error)
      }
    }
    reader.readAsText(file)
  }

  const resetToDefaults = () => {
    setSrcCols(8)
    setSrcRows(4)
    setTargetWidth(32)
    setTargetHeight(32)
    setPaletteSize(16)
    setEnableDithering(true)
    setFps(12)
  }

  return (
    <div className="app">
      <h1>スプライトシート ドット絵変換ツール</h1>
      
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />

      <div className="top-section">
        <div className="upload-section">
          <button
            className="upload-button"
            onClick={() => fileInputRef.current?.click()}
          >
            スプライトシートを選択
          </button>
        </div>

        <div className="controls">
          <div className="control-group">
            <h3>元のスプライト設定</h3>
          <label>
            横のフレーム数:
            <input
              type="number"
              min="1"
              value={srcCols}
              onChange={(e) => setSrcCols(parseInt(e.target.value) || 1)}
            />
          </label>
          <label>
            縦のフレーム数:
            <input
              type="number"
              min="1"
              value={srcRows}
              onChange={(e) => setSrcRows(parseInt(e.target.value) || 1)}
            />
          </label>
        </div>

        <div className="control-group">
          <h3>ターゲット設定</h3>
          <label>
            ターゲット幅 (px):
            <input
              type="number"
              min="8"
              value={targetWidth}
              onChange={(e) => setTargetWidth(parseInt(e.target.value) || 8)}
            />
          </label>
          <label>
            ターゲット高さ (px):
            <input
              type="number"
              min="8"
              value={targetHeight}
              onChange={(e) => setTargetHeight(parseInt(e.target.value) || 8)}
            />
          </label>
          <label>
            パレット色数:
            <input
              type="number"
              min="2"
              max="256"
              value={paletteSize}
              onChange={(e) => setPaletteSize(parseInt(e.target.value) || 2)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={enableDithering}
              onChange={(e) => setEnableDithering(e.target.checked)}
            />
            ディザリングを有効化
          </label>
          </div>

          <div className="control-group">
            <button
              className="process-button"
              onClick={processSprites}
              disabled={!originalImage}
            >
              変換実行
            </button>
            <div className="settings-controls">
              <button onClick={saveAllSettings}>設定を保存</button>
              <input
                type="file"
                accept=".json"
                onChange={loadSettingsFromFile}
                style={{ display: 'none' }}
                id="settings-file-input"
              />
              <button onClick={() => document.getElementById('settings-file-input')?.click()}>
                設定を読込
              </button>
              <button onClick={resetToDefaults}>初期値に戻す</button>
            </div>
          </div>
        </div>
      </div>

      {originalImage && frames.length > 0 && (
        <div className="main-content">
          <div className="frame-selection-section">
            <h3>フレーム選択</h3>
            <div className="frame-controls">
              <button onClick={selectAll}>全選択</button>
              <button onClick={deselectAll}>全解除</button>
              <span className="selected-count">
                {frames.filter(f => f.selected).length} / {frames.length} フレーム選択中
              </span>
            </div>
            <div className="sprite-grid">
              {frames.map((frame) => (
                <div
                  key={frame.index}
                  className={`sprite-frame ${frame.selected ? 'selected' : ''}`}
                  onClick={() => toggleFrame(frame.index)}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundImage: `url(${originalImage})`,
                      backgroundSize: `${srcCols * 100}% ${srcRows * 100}%`,
                      backgroundPosition: `${-(frame.index % srcCols) * 100}% ${-Math.floor(frame.index / srcCols) * 100}%`,
                      imageRendering: 'pixelated'
                    }}
                  />
                  <div className="frame-number">{frame.index + 1}</div>
                </div>
              ))}
            </div>
          </div>

          {processedImageUrl && (
            <div className="results-panel">
              <div className="result-section">
                <h3>変換結果</h3>
                <div className="result-container">
                  <img 
                    src={processedImageUrl} 
                    alt="Processed sprite sheet" 
                    className="result-image"
                  />
                  <button className="download-button" onClick={downloadResult}>
                    ダウンロード
                  </button>
                </div>
              </div>

              <div className="animation-preview">
                <h3>アニメーションプレビュー</h3>
                <div className="animation-controls">
                  <canvas ref={animationCanvasRef} className="animation-canvas" />
                  <div className="animation-buttons">
                    <button onClick={() => setIsPlaying(!isPlaying)}>
                      {isPlaying ? '⏸ 一時停止' : '▶ 再生'}
                    </button>
                    <label>
                      FPS:
                      <input
                        type="number"
                        min="1"
                        max="60"
                        value={fps}
                        onChange={(e) => setFps(parseInt(e.target.value) || 1)}
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App