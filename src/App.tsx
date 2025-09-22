import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { removeBackgroundFromImage, scaleImageNearestNeighbor, exportCanvasAsPNG } from './imageProcessing'
import { NumberInput } from './NumberInput'

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
  const [removeBackground, setRemoveBackground] = useState(false)
  const [backgroundTolerance, setBackgroundTolerance] = useState(10)
  const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [fps, setFps] = useState(() => loadSetting(STORAGE_KEYS.fps, 12) as number)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [isProcessingVideo, setIsProcessingVideo] = useState(false)
  const [videoProgress, setVideoProgress] = useState({ current: 0, total: 0 })

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
    localStorage.setItem(STORAGE_KEYS.fps, fps.toString())
  }, [fps])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Check if it's a video file
    if (file.type.startsWith('video/')) {
      handleVideoUpload(file)
    } else {
      // Handle image file as before
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
  }

  const handleVideoUpload = async (file: File) => {
    setIsProcessingVideo(true)
    setVideoProgress({ current: 0, total: 0 })
    
    const videoUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.src = videoUrl
    video.muted = true
    
    // Wait for video metadata to load
    await new Promise((resolve) => {
      video.addEventListener('loadedmetadata', resolve, { once: true })
    })
    
    const duration = video.duration
    const fps = 30 // Assume 30fps for sampling calculation
    const totalFrames = Math.floor(duration * fps)
    const sampleInterval = 10 // Sample every 10 frames
    const samplesToTake = Math.min(Math.floor(totalFrames / sampleInterval), 50) // Max 50 samples
    
    setVideoProgress({ current: 0, total: samplesToTake })
    
    // Canvas for extracting frames
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d', {
      alpha: true,
      colorSpace: 'srgb'
    })
    if (!ctx) {
      setIsProcessingVideo(false)
      return
    }
    
    // Disable smoothing
    ctx.imageSmoothingEnabled = false
    
    // Extract frames
    const extractedFrames: string[] = []
    
    // Process frames in chunks to avoid blocking UI
    const processFrame = async (i: number) => {
      if (i >= samplesToTake) {
        // All frames processed, create sprite sheet
        await createSpriteSheet(extractedFrames, video.videoWidth, video.videoHeight)
        URL.revokeObjectURL(videoUrl)
        setIsProcessingVideo(false)
        return
      }
      
      const time = (i * sampleInterval) / fps
      video.currentTime = time
      
      await new Promise((resolve) => {
        video.addEventListener('seeked', resolve, { once: true })
      })
      
      // Draw current frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      extractedFrames.push(exportCanvasAsPNG(canvas))
      
      setVideoProgress({ current: i + 1, total: samplesToTake })
      
      // Process next frame after a short delay to keep UI responsive
      setTimeout(() => processFrame(i + 1), 10)
    }
    
    // Start processing
    processFrame(0)
  }
  
  const createSpriteSheet = async (frames: string[], frameWidth: number, frameHeight: number) => {
    const cols = Math.ceil(Math.sqrt(frames.length))
    const rows = Math.ceil(frames.length / cols)
    
    const spriteCanvas = document.createElement('canvas')
    spriteCanvas.width = frameWidth * cols
    spriteCanvas.height = frameHeight * rows
    const spriteCtx = spriteCanvas.getContext('2d', {
      alpha: true,
      colorSpace: 'srgb'
    })
    if (!spriteCtx) return
    
    // Disable smoothing
    spriteCtx.imageSmoothingEnabled = false
    
    // Draw all frames to sprite sheet
    for (let i = 0; i < frames.length; i++) {
      const img = new Image()
      img.src = frames[i]
      await new Promise((resolve) => {
        img.onload = resolve
      })
      
      const col = i % cols
      const row = Math.floor(i / cols)
      spriteCtx.drawImage(
        img,
        col * frameWidth,
        row * frameHeight,
        frameWidth,
        frameHeight
      )
    }
    
    // Set the sprite sheet as the original image
    setOriginalImage(exportCanvasAsPNG(spriteCanvas))
    setSrcCols(cols)
    setSrcRows(rows)
    
    // Generate frames for the sprite sheet
    generateFrames(spriteCanvas.width, spriteCanvas.height)
  }

  const generateFrames = useCallback((imageWidth: number, imageHeight: number) => {
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
  }, [srcCols, srcRows])

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
      const ctx = resultCanvas.getContext('2d', {
        alpha: true,
        colorSpace: 'srgb',
        willReadFrequently: true
      })
      if (!ctx) return
      
      // Disable smoothing for pixel-perfect rendering
      ctx.imageSmoothingEnabled = false
      ctx.imageSmoothingQuality = 'low'

      selectedFrames.forEach((frame, idx) => {
        const destCol = idx % outputCols
        const destRow = Math.floor(idx / outputCols)

        // Create temporary canvas for processing
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = frame.width
        tempCanvas.height = frame.height
        const tempCtx = tempCanvas.getContext('2d', {
          alpha: true,
          colorSpace: 'srgb',
          willReadFrequently: true
        })
        if (!tempCtx) return
        
        // Disable smoothing
        tempCtx.imageSmoothingEnabled = false
        tempCtx.imageSmoothingQuality = 'low'

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

        // Scale down to target size using nearest neighbor interpolation
        const scaledCanvas = scaleImageNearestNeighbor(tempCanvas, targetWidth, targetHeight)
        const scaledCtx = scaledCanvas.getContext('2d')
        if (!scaledCtx) return

        // Remove background if enabled
        if (removeBackground) {
          const imageData = scaledCtx.getImageData(0, 0, targetWidth, targetHeight)
          const processedData = removeBackgroundFromImage(imageData, targetWidth, targetHeight, backgroundTolerance)
          scaledCtx.putImageData(processedData, 0, 0)
        }

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

      setProcessedImageUrl(exportCanvasAsPNG(resultCanvas))
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
  }, [srcCols, srcRows, originalImage, generateFrames])

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
    setFps(12)
  }

  return (
    <div className="app">
      <h1>スプライトシート ドット絵変換ツール</h1>
      
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/mp4"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
        disabled={isProcessingVideo}
      />

      {isProcessingVideo && (
        <div className="video-progress">
          <div className="progress-content">
            <p>動画を処理中...</p>
            <progress value={videoProgress.current} max={videoProgress.total} />
            <p>{videoProgress.current} / {videoProgress.total} フレーム</p>
          </div>
        </div>
      )}

      <div className="top-section">
        <div className="upload-section">
          <button
            className="upload-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessingVideo}
          >
            {isProcessingVideo ? '処理中...' : '画像/動画を選択'}
          </button>
        </div>

        <div className="controls">
          <div className="control-group">
            <h3>元のスプライト設定</h3>
          <label>
            横のフレーム数:
            <NumberInput
              min={1}
              value={srcCols}
              onChange={setSrcCols}
            />
          </label>
          <label>
            縦のフレーム数:
            <NumberInput
              min={1}
              value={srcRows}
              onChange={setSrcRows}
            />
          </label>
        </div>

        <div className="control-group">
          <h3>ターゲット設定</h3>
          <label>
            ターゲット幅 (px):
            <NumberInput
              min={8}
              value={targetWidth}
              onChange={setTargetWidth}
            />
          </label>
          <label>
            ターゲット高さ (px):
            <NumberInput
              min={8}
              value={targetHeight}
              onChange={setTargetHeight}
            />
          </label>
          <label>
            背景を透過:
            <input
              type="checkbox"
              checked={removeBackground}
              onChange={(e) => setRemoveBackground(e.target.checked)}
            />
          </label>
          {removeBackground && (
            <label>
              透過の許容値:
              <NumberInput
                min={0}
                max={50}
                value={backgroundTolerance}
                onChange={setBackgroundTolerance}
              />
            </label>
          )}
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
                      <NumberInput
                        min={1}
                        max={60}
                        value={fps}
                        onChange={setFps}
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