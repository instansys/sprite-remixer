import { decompressFrames, parseGIF } from 'gifuct-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { type BackgroundColorSource, exportCanvasAsPNG, removeBackgroundFromImage, scaleImageNearestNeighbor } from './imageProcessing'
import { NumberInput } from './NumberInput'

interface FrameData {
  index: number // グローバルインデックス（全フレーム通し番号）
  localIndex: number // ソース内でのインデックス
  x: number
  y: number
  width: number
  height: number
  selected: boolean
  sourceIndex: number // どのソース画像からのフレームか
}

interface SourceImage {
  id: string
  name: string
  imageUrl: string
  cols: number
  rows: number
}

interface PendingImage {
  file: File
  imageUrl: string
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

  const [sourceImages, setSourceImages] = useState<SourceImage[]>([])
  const [frames, setFrames] = useState<FrameData[]>([])
  const [srcCols, setSrcCols] = useState(() => loadSetting(STORAGE_KEYS.srcCols, 8) as number)
  const [srcRows, setSrcRows] = useState(() => loadSetting(STORAGE_KEYS.srcRows, 4) as number)
  const [targetWidth, setTargetWidth] = useState(() => loadSetting(STORAGE_KEYS.targetWidth, 32) as number)
  const [targetHeight, setTargetHeight] = useState(() => loadSetting(STORAGE_KEYS.targetHeight, 32) as number)
  const [lockAspectRatio, setLockAspectRatio] = useState(false)
  const lockedAspectRatioRef = useRef(1) // height / width at the time of locking
  const [removeBackground, setRemoveBackground] = useState(false)
  const [backgroundTolerance, setBackgroundTolerance] = useState(10)
  const [edgeErosion, setEdgeErosion] = useState(0)
  const [bgColorSource, setBgColorSource] = useState<BackgroundColorSource>('auto')
  const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [fps, setFps] = useState(() => loadSetting(STORAGE_KEYS.fps, 12) as number)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [isProcessingVideo, setIsProcessingVideo] = useState(false)
  const [videoProgress, setVideoProgress] = useState({ current: 0, total: 0 })

  // ソース設定ダイアログ用のステート
  const [showSourceDialog, setShowSourceDialog] = useState(false)
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null)
  const [dialogCols, setDialogCols] = useState(srcCols)
  const [dialogRows, setDialogRows] = useState(srcRows)

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

  // Maintain aspect ratio when targetWidth changes and lockAspectRatio is enabled
  const prevTargetWidthRef = useRef(targetWidth)
  useEffect(() => {
    if (lockAspectRatio && prevTargetWidthRef.current !== targetWidth) {
      const newHeight = Math.max(8, Math.round(targetWidth * lockedAspectRatioRef.current))
      setTargetHeight(newHeight)
    }
    prevTargetWidthRef.current = targetWidth
  }, [targetWidth, lockAspectRatio])


  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.fps, fps.toString())
  }, [fps])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    // Process all files
    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      // Check if it's a video file
      if (file.type.startsWith('video/')) {
        await handleVideoUpload(file)
      } else if (file.type === 'image/gif') {
        // Handle GIF file
        await handleGifUpload(file)
      } else {
        // Handle image file
        await handleImageUpload(file)
      }
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleImageUpload = (file: File): Promise<void> => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const imageUrl = event.target?.result as string

        // ダイアログを表示して設定を確認
        setPendingImage({ file, imageUrl })
        setDialogCols(srcCols)
        setDialogRows(srcRows)
        setShowSourceDialog(true)
        resolve()
      }
      reader.readAsDataURL(file)
    })
  }

  // ダイアログで確定した時の処理
  const confirmSourceSettings = () => {
    if (!pendingImage) return

    const newSource: SourceImage = {
      id: `source-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      name: pendingImage.file.name,
      imageUrl: pendingImage.imageUrl,
      cols: dialogCols,
      rows: dialogRows
    }

    setSourceImages(prev => [...prev, newSource])
    setSrcCols(dialogCols)
    setSrcRows(dialogRows)
    setShowSourceDialog(false)
    setPendingImage(null)
  }

  // ダイアログをキャンセルした時の処理
  const cancelSourceSettings = () => {
    setShowSourceDialog(false)
    setPendingImage(null)
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
        await createSpriteSheet(extractedFrames, video.videoWidth, video.videoHeight, file.name)
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

  // Helper function to check if a canvas is mostly empty/transparent
  const isCanvasEmpty = (canvas: HTMLCanvasElement, threshold: number = 0.01): boolean => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return true

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    let opaquePixels = 0
    const totalPixels = canvas.width * canvas.height

    // Count pixels with alpha > 10
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 10) {
        opaquePixels++
      }
    }

    // If less than threshold% of pixels are opaque, consider it empty
    return (opaquePixels / totalPixels) < threshold
  }

  const handleGifUpload = async (file: File) => {
    setIsProcessingVideo(true)
    setVideoProgress({ current: 0, total: 0 })

    try {
      // Read file as ArrayBuffer
      const buffer = await file.arrayBuffer()

      // Parse GIF
      const gif = parseGIF(buffer)
      const gifFrames = decompressFrames(gif, true)

      if (gifFrames.length === 0) {
        setIsProcessingVideo(false)
        return
      }

      setVideoProgress({ current: 0, total: gifFrames.length })

      // Get dimensions from first frame
      const frameWidth = gifFrames[0].dims.width
      const frameHeight = gifFrames[0].dims.height

      // Canvas for accumulating frames
      const canvas = document.createElement('canvas')
      canvas.width = frameWidth
      canvas.height = frameHeight
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

      // Canvas for saving previous frame (for disposalType 3)
      const prevCanvas = document.createElement('canvas')
      prevCanvas.width = frameWidth
      prevCanvas.height = frameHeight
      const prevCtx = prevCanvas.getContext('2d', {
        alpha: true,
        colorSpace: 'srgb'
      })
      if (!prevCtx) {
        setIsProcessingVideo(false)
        return
      }
      prevCtx.imageSmoothingEnabled = false

      // Extract all frames
      const extractedFrames: string[] = []

      // Process frames
      for (let i = 0; i < gifFrames.length; i++) {
        const frame = gifFrames[i]

        // Save current state BEFORE drawing (for disposalType 3 to restore later)
        if (frame.disposalType === 3) {
          prevCtx.clearRect(0, 0, frameWidth, frameHeight)
          prevCtx.drawImage(canvas, 0, 0)
        }

        // Create a temporary canvas for this frame's patch
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = frame.dims.width
        tempCanvas.height = frame.dims.height
        const tempCtx = tempCanvas.getContext('2d', {
          alpha: true,
          colorSpace: 'srgb'
        })
        if (!tempCtx) continue

        tempCtx.imageSmoothingEnabled = false

        // Create ImageData from frame patch
        const imageData = new ImageData(
          new Uint8ClampedArray(frame.patch),
          frame.dims.width,
          frame.dims.height
        )

        // Put the patch data on the temporary canvas
        tempCtx.putImageData(imageData, 0, 0)

        // Draw the patch onto the main canvas at the correct position
        // This properly handles alpha blending
        ctx.drawImage(
          tempCanvas,
          0, 0, frame.dims.width, frame.dims.height,
          frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height
        )

        // Check if the current frame is mostly empty and skip if so
        if (!isCanvasEmpty(canvas)) {
          // Export current canvas state as PNG only if not empty
          extractedFrames.push(exportCanvasAsPNG(canvas))
        }

        // Apply disposal method AFTER exporting the frame
        if (frame.disposalType === 2) {
          // Clear to background (transparent)
          ctx.clearRect(
            frame.dims.left,
            frame.dims.top,
            frame.dims.width,
            frame.dims.height
          )
        } else if (frame.disposalType === 3) {
          // Restore to previous state (before this frame was drawn)
          ctx.clearRect(0, 0, frameWidth, frameHeight)
          ctx.drawImage(prevCanvas, 0, 0)
        }
        // disposalType 0 or 1: do nothing (keep current canvas state for next frame)

        setVideoProgress({ current: i + 1, total: gifFrames.length })

        // Small delay to keep UI responsive
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      // Create sprite sheet from extracted frames
      await createSpriteSheet(extractedFrames, frameWidth, frameHeight, file.name)
      setIsProcessingVideo(false)
    } catch (error) {
      console.error('Failed to process GIF:', error)
      setIsProcessingVideo(false)
    }
  }

  const createSpriteSheet = async (extractedFrames: string[], frameWidth: number, frameHeight: number, fileName: string) => {
    const cols = Math.ceil(Math.sqrt(extractedFrames.length))
    const rows = Math.ceil(extractedFrames.length / cols)

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
    for (let i = 0; i < extractedFrames.length; i++) {
      const img = new Image()
      img.src = extractedFrames[i]
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

    // Add as new source image
    const newSource: SourceImage = {
      id: `source-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      name: fileName,
      imageUrl: exportCanvasAsPNG(spriteCanvas),
      cols,
      rows
    }
    setSourceImages(prev => [...prev, newSource])

    // Set target size to match original frame dimensions
    setTargetWidth(frameWidth)
    setTargetHeight(frameHeight)
  }

  // Generate frames from all source images
  const generateAllFrames = useCallback(() => {
    const newFrames: FrameData[] = []
    let globalIndex = 0

    sourceImages.forEach((source, sourceIndex) => {
      // Load image to get dimensions
      const img = new Image()
      img.src = source.imageUrl
      // Note: This is sync because we need dimensions immediately
      // In a real scenario, we'd precompute these

      const frameCount = source.cols * source.rows
      for (let localIndex = 0; localIndex < frameCount; localIndex++) {
        const col = localIndex % source.cols
        const row = Math.floor(localIndex / source.cols)

        newFrames.push({
          index: globalIndex,
          localIndex,
          x: col, // Store col/row instead of pixel coords
          y: row,
          width: source.cols,
          height: source.rows,
          selected: false,
          sourceIndex
        })
        globalIndex++
      }
    })

    setFrames(newFrames)
  }, [sourceImages])

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
    if (sourceImages.length === 0 || frames.length === 0) return

    const selectedFrames = frames.filter(f => f.selected)
    if (selectedFrames.length === 0) return

    // Load all source images first
    const loadedImages: { [key: number]: HTMLImageElement } = {}
    await Promise.all(
      sourceImages.map((source, idx) => {
        return new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => {
            loadedImages[idx] = img
            resolve()
          }
          img.src = source.imageUrl
        })
      })
    )

    // Calculate output layout
    const outputCols = Math.ceil(Math.sqrt(selectedFrames.length))
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

      const sourceImg = loadedImages[frame.sourceIndex]
      const source = sourceImages[frame.sourceIndex]
      if (!sourceImg || !source) return

      // Calculate frame dimensions from source image
      const frameWidth = sourceImg.width / source.cols
      const frameHeight = sourceImg.height / source.rows
      const srcX = frame.x * frameWidth
      const srcY = frame.y * frameHeight

      // Create temporary canvas for processing
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = frameWidth
      tempCanvas.height = frameHeight
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
        sourceImg,
        srcX,
        srcY,
        frameWidth,
        frameHeight,
        0,
        0,
        frameWidth,
        frameHeight
      )

      // Scale down to target size using nearest neighbor interpolation
      const scaledCanvas = scaleImageNearestNeighbor(tempCanvas, targetWidth, targetHeight)
      const scaledCtx = scaledCanvas.getContext('2d')
      if (!scaledCtx) return

      // Remove background if enabled
      if (removeBackground) {
        const imageData = scaledCtx.getImageData(0, 0, targetWidth, targetHeight)
        const processedData = removeBackgroundFromImage(imageData, targetWidth, targetHeight, backgroundTolerance, edgeErosion, bgColorSource)
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

  // Regenerate frames when sourceImages change or when source settings change
  useEffect(() => {
    generateAllFrames()
  }, [generateAllFrames])

  // Update source cols/rows when global settings change
  const updateSourceSettings = useCallback((sourceId: string, cols: number, rows: number) => {
    setSourceImages(prev => prev.map(source =>
      source.id === sourceId ? { ...source, cols, rows } : source
    ))
  }, [])

  // Remove a source image
  const removeSource = useCallback((sourceId: string) => {
    setSourceImages(prev => prev.filter(source => source.id !== sourceId))
  }, [])

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
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <div className="logo-icon">🎮</div>
            <h1>Sprite Remixer</h1>
          </div>
          <div className="header-actions">
            <button className="btn" onClick={saveAllSettings}>
              💾 設定を保存
            </button>
            <input
              type="file"
              accept=".json"
              onChange={loadSettingsFromFile}
              style={{ display: 'none' }}
              id="settings-file-input"
            />
            <button className="btn" onClick={() => document.getElementById('settings-file-input')?.click()}>
              📂 設定を読込
            </button>
            <button className="btn" onClick={resetToDefaults}>
              ↺ リセット
            </button>
          </div>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/mp4"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
        disabled={isProcessingVideo}
        multiple
      />

      {isProcessingVideo && (
        <div className="video-progress">
          <div className="progress-content">
            <p>処理中...</p>
            <progress value={videoProgress.current} max={videoProgress.total} />
            <p>{videoProgress.current} / {videoProgress.total} フレーム</p>
          </div>
        </div>
      )}

      {/* ソース設定ダイアログ */}
      {showSourceDialog && pendingImage && (
        <div className="source-dialog-overlay">
          <div className="source-dialog">
            <div className="source-dialog-header">
              <h3>ソース設定</h3>
            </div>
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
                  onChange={setDialogCols}
                />
              </label>
              <label>
                縦のフレーム数
                <NumberInput
                  min={1}
                  value={dialogRows}
                  onChange={setDialogRows}
                />
              </label>
            </div>
            <div className="source-dialog-actions">
              <button className="btn" onClick={cancelSourceSettings}>
                キャンセル
              </button>
              <button className="btn btn-primary" onClick={confirmSourceSettings}>
                追加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Controls Section */}
      <div className="top-section">
        <div className="top-section-content">
          <div className="upload-section">
            <button
              className="upload-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessingVideo}
            >
              {isProcessingVideo ? '⏳ 処理中...' : '📁 ファイルを追加'}
            </button>
          </div>

          <div className="controls">
            <div className="control-group">
              <h3>出力設定</h3>
              <label>
                アスペクト比固定
                <input
                  type="checkbox"
                  checked={lockAspectRatio}
                  onChange={(e) => {
                    if (e.target.checked && targetWidth > 0) {
                      lockedAspectRatioRef.current = targetHeight / targetWidth
                    }
                    setLockAspectRatio(e.target.checked)
                  }}
                />
              </label>
              <label>
                出力幅 (px)
                <NumberInput
                  min={8}
                  value={targetWidth}
                  onChange={setTargetWidth}
                />
              </label>
              <label>
                出力高さ (px)
                <NumberInput
                  key={lockAspectRatio ? `locked-${targetHeight}` : 'unlocked'}
                  min={8}
                  value={targetHeight}
                  onChange={setTargetHeight}
                  disabled={lockAspectRatio}
                />
              </label>
            </div>

            <div className="control-group">
              <h3>背景除去</h3>
              <label>
                背景を透過
                <input
                  type="checkbox"
                  checked={removeBackground}
                  onChange={(e) => setRemoveBackground(e.target.checked)}
                />
              </label>
              {removeBackground && (
                <>
                  <label>
                    検出位置
                    <select
                      value={bgColorSource}
                      onChange={(e) => setBgColorSource(e.target.value as BackgroundColorSource)}
                    >
                      <option value="auto">自動</option>
                      <option value="top-left">左上</option>
                      <option value="top-right">右上</option>
                      <option value="bottom-left">左下</option>
                      <option value="bottom-right">右下</option>
                    </select>
                  </label>
                  <label>
                    許容値
                    <NumberInput
                      min={0}
                      max={255}
                      value={backgroundTolerance}
                      onChange={setBackgroundTolerance}
                    />
                  </label>
                  <label>
                    侵食 (px)
                    <NumberInput
                      min={0}
                      max={10}
                      value={edgeErosion}
                      onChange={setEdgeErosion}
                    />
                  </label>
                </>
              )}
              <button
                className="process-button"
                onClick={processSprites}
                disabled={sourceImages.length === 0}
              >
                ✨ 変換実行
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      {sourceImages.length > 0 ? (
        <div className="main-content">
          {/* Frame Selection Card */}
          <div className="card frame-selection-section">
            <div className="card-header">
              <h3>🎞️ フレーム選択</h3>
            </div>
            <div className="frame-controls">
              <button onClick={selectAll}>全選択</button>
              <button onClick={deselectAll}>全解除</button>
              <span className="selected-count">
                {frames.filter(f => f.selected).length} / {frames.length} 選択中
              </span>
            </div>

            {/* Source images list with their frames */}
            {sourceImages.map((source, sourceIdx) => {
              const sourceFrames = frames.filter(f => f.sourceIndex === sourceIdx)
              return (
                <div key={source.id} className="source-section">
                  <div className="source-header">
                    <span className="source-name">{source.name}</span>
                    <div className="source-controls">
                      <label>
                        横
                        <NumberInput
                          min={1}
                          value={source.cols}
                          onChange={(cols) => updateSourceSettings(source.id, cols, source.rows)}
                        />
                      </label>
                      <label>
                        縦
                        <NumberInput
                          min={1}
                          value={source.rows}
                          onChange={(rows) => updateSourceSettings(source.id, source.cols, rows)}
                        />
                      </label>
                      <button
                        className="remove-source-button"
                        onClick={() => removeSource(source.id)}
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
                        onClick={() => toggleFrame(frame.index)}
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
          </div>

          {/* Results Panel */}
          {processedImageUrl && (
            <div className="results-panel">
              <div className="result-section">
                <h3>📦 変換結果</h3>
                <div className="result-container">
                  <img
                    src={processedImageUrl}
                    alt="Processed sprite sheet"
                    className="result-image"
                  />
                  <button className="download-button" onClick={downloadResult}>
                    ⬇️ ダウンロード
                  </button>
                </div>
              </div>

              <div className="animation-preview">
                <h3>▶️ プレビュー</h3>
                <div className="animation-controls">
                  <div className="animation-canvas-wrapper">
                    <canvas ref={animationCanvasRef} className="animation-canvas" />
                  </div>
                  <div className="animation-buttons">
                    <button onClick={() => setIsPlaying(!isPlaying)}>
                      {isPlaying ? '⏸ 停止' : '▶ 再生'}
                    </button>
                    <label>
                      FPS
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
      ) : (
        <div className="main-content">
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">🖼️</div>
              <h2>ファイルをアップロード</h2>
              <p>スプライトシート画像、動画、またはGIFファイルをドラッグ＆ドロップするか、上のボタンからファイルを選択してください。</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App