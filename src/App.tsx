import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

import type { PendingImage, FrameSamplingQuality, OutputFormat, VideoProgress, SourceImage } from './types'
import type { BackgroundColorSource } from './imageProcessing'
import { STORAGE_KEYS, DEFAULT_SETTINGS } from './constants'
import { useLocalStorage, useLocalStorageString, useFrameSelection, useAnimation, useSourceImages } from './hooks'
import {
  Header,
  VideoProgressModal,
  SourceSettingsDialog,
  VideoSamplingDialog,
  OutputSettings,
  BackgroundRemovalSettings,
  FrameGrid,
  ResultsPanel,
  EmptyState
} from './components'
import {
  extractVideoFrames,
  extractGifFrames,
  createSpriteSheet,
  processSprites,
  downloadImage,
  saveSettingsToFile,
  loadSettingsFromFile,
  getDefaultSettings,
  exportAnimatedGif,
  detectSpriteGrid
} from './utils'

// 画像の自然寸法を取得する
function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = src
  })
}

function App() {
  // Settings with localStorage persistence
  const [srcCols, setSrcCols] = useLocalStorage(STORAGE_KEYS.srcCols, DEFAULT_SETTINGS.srcCols)
  const [srcRows, setSrcRows] = useLocalStorage(STORAGE_KEYS.srcRows, DEFAULT_SETTINGS.srcRows)
  const [targetWidth, setTargetWidth] = useLocalStorage(STORAGE_KEYS.targetWidth, DEFAULT_SETTINGS.targetWidth)
  const [targetHeight, setTargetHeight] = useLocalStorage(STORAGE_KEYS.targetHeight, DEFAULT_SETTINGS.targetHeight)
  const [outputCols, setOutputCols] = useLocalStorage(STORAGE_KEYS.outputCols, DEFAULT_SETTINGS.outputCols)
  const [outputFormat, setOutputFormat] = useLocalStorageString<OutputFormat>(
    STORAGE_KEYS.outputFormat,
    DEFAULT_SETTINGS.outputFormat
  )
  const [fps, setFps] = useLocalStorage(STORAGE_KEYS.fps, DEFAULT_SETTINGS.fps)
  const [frameSamplingQuality, setFrameSamplingQuality] = useLocalStorageString<FrameSamplingQuality>(
    STORAGE_KEYS.frameSamplingQuality,
    DEFAULT_SETTINGS.frameSamplingQuality
  )

  // Aspect ratio locking
  const [lockAspectRatio, setLockAspectRatio] = useState(false)
  const lockedAspectRatioRef = useRef(1)

  // Background removal settings
  const [removeBackground, setRemoveBackground] = useState(false)
  const [backgroundTolerance, setBackgroundTolerance] = useState(10)
  const [edgeErosion, setEdgeErosion] = useState(0)
  const [bgColorSource, setBgColorSource] = useState<BackgroundColorSource>('auto')
  const [fillInterior, setFillInterior] = useState(false)

  // Processing state
  const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null)
  const [isProcessingVideo, setIsProcessingVideo] = useState(false)
  const [videoProgress, setVideoProgress] = useState<VideoProgress>({ current: 0, total: 0 })
  const [isEncodingGif, setIsEncodingGif] = useState(false)
  const [gifProgress, setGifProgress] = useState<VideoProgress>({ current: 0, total: 0 })

  // Source dialog state
  const [showSourceDialog, setShowSourceDialog] = useState(false)
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  // 動画はサンプリング品質を読み込み時に選んでもらうため、抽出前にキューへ積んでダイアログで確認する
  const [pendingVideos, setPendingVideos] = useState<File[]>([])
  const [dialogCols, setDialogCols] = useState(srcCols)
  const [dialogRows, setDialogRows] = useState(srcRows)
  const [isDialogProcessing, setIsDialogProcessing] = useState(false)

  // Current pending image (first in queue)
  const pendingImage = pendingImages.length > 0 ? pendingImages[0] : null
  // Current pending video (first in queue)
  const pendingVideo = pendingVideos.length > 0 ? pendingVideos[0] : null

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Custom hooks
  const { sourceImages, addSource, updateSourceSettings, removeSource, generateSourceId } = useSourceImages()
  const {
    frames,
    isGeneratingFrames,
    toggleFrame,
    selectAll,
    deselectAll,
    selectedFrames,
    selectedCount,
    totalCount
  } = useFrameSelection(sourceImages)

  const {
    isPlaying,
    isReversed,
    togglePlayback,
    toggleReverse,
    canvasRef: animationCanvasRef
  } = useAnimation({
    processedImageUrl,
    selectedFrames,
    fps,
    targetWidth,
    targetHeight,
    outputCols
  })

  // Aspect ratio handling
  const prevTargetWidthRef = useRef(targetWidth)
  useEffect(() => {
    if (lockAspectRatio && prevTargetWidthRef.current !== targetWidth) {
      const newHeight = Math.max(8, Math.round(targetWidth * lockedAspectRatioRef.current))
      setTargetHeight(newHeight)
    }
    prevTargetWidthRef.current = targetWidth
  }, [targetWidth, lockAspectRatio, setTargetHeight])

  // File upload handling
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      if (file.type.startsWith('video/')) {
        // 抽出はサンプリング品質をダイアログで選んでから行う
        setPendingVideos(prev => [...prev, file])
      } else if (file.type === 'image/gif') {
        await handleGifUpload(file)
      } else {
        await handleImageUpload(file)
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleImageUpload = (file: File): Promise<void> => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = async (event) => {
        const imageUrl = event.target?.result as string
        // n×m分割を自動検出してダイアログの初期値に使う（失敗時はnull）
        const detected = await detectSpriteGrid(imageUrl).catch(() => null)
        const pending: PendingImage = {
          file,
          imageUrl,
          detectedCols: detected?.cols,
          detectedRows: detected?.rows
        }
        setPendingImages(prev => [...prev, pending])
        // Only set dialog settings and show dialog for the first image in queue
        if (!showSourceDialog) {
          setDialogCols(detected?.cols ?? srcCols)
          setDialogRows(detected?.rows ?? srcRows)
          setShowSourceDialog(true)
        }
        resolve()
      }
      reader.readAsDataURL(file)
    })
  }

  const handleVideoUpload = async (file: File) => {
    setIsProcessingVideo(true)
    setVideoProgress({ current: 0, total: 0 })

    try {
      const { frames: extractedFrames, width, height } = await extractVideoFrames(
        file,
        frameSamplingQuality,
        setVideoProgress
      )

      if (extractedFrames.length > 0) {
        const { imageUrl, cols, rows } = await createSpriteSheet(extractedFrames, width, height)

        const newSource: SourceImage = {
          id: generateSourceId(),
          name: file.name,
          imageUrl,
          cols,
          rows,
          sourceType: 'video'
        }
        addSource(newSource)
        setTargetWidth(width)
        setTargetHeight(height)
      }
    } catch (error) {
      console.error('Failed to process video:', error)
    } finally {
      setIsProcessingVideo(false)
    }
  }

  const handleGifUpload = async (file: File) => {
    setIsProcessingVideo(true)
    setVideoProgress({ current: 0, total: 0 })

    try {
      const { frames: extractedFrames, width, height } = await extractGifFrames(file, setVideoProgress)

      if (extractedFrames.length > 0) {
        const { imageUrl, cols, rows } = await createSpriteSheet(extractedFrames, width, height)

        const newSource: SourceImage = {
          id: generateSourceId(),
          name: file.name,
          imageUrl,
          cols,
          rows,
          sourceType: 'gif'
        }
        addSource(newSource)
        setTargetWidth(width)
        setTargetHeight(height)
      }
    } catch (error) {
      console.error('Failed to process GIF:', error)
    } finally {
      setIsProcessingVideo(false)
    }
  }

  // n×m と元寸法から1フレームの出力px（幅・高さ）を求めて出力設定に反映する
  const applyFrameOutputSize = (
    naturalWidth: number,
    naturalHeight: number,
    cols: number,
    rows: number
  ) => {
    if (naturalWidth > 0 && cols > 0) setTargetWidth(Math.max(1, Math.round(naturalWidth / cols)))
    if (naturalHeight > 0 && rows > 0) setTargetHeight(Math.max(1, Math.round(naturalHeight / rows)))
  }

  // フレーム選択側で分割数が変わったら、出力サイズも追従させる
  const handleUpdateSourceSettings = (sourceId: string, cols: number, rows: number) => {
    updateSourceSettings(sourceId, cols, rows)
    const source = sourceImages.find(s => s.id === sourceId)
    if (source?.naturalWidth && source?.naturalHeight) {
      applyFrameOutputSize(source.naturalWidth, source.naturalHeight, cols, rows)
    }
  }

  // Source dialog handling
  const confirmSourceSettings = async () => {
    if (!pendingImage) return

    setIsDialogProcessing(true)
    await new Promise(resolve => setTimeout(resolve, 0))

    // 元シートの自然寸法を取得し、1フレームあたりの出力pxを導出する
    const { width: naturalWidth, height: naturalHeight } = await loadImageSize(
      pendingImage.imageUrl
    ).catch(() => ({ width: 0, height: 0 }))

    const newSource: SourceImage = {
      id: generateSourceId(),
      name: pendingImage.file.name,
      imageUrl: pendingImage.imageUrl,
      cols: dialogCols,
      rows: dialogRows,
      sourceType: 'image',
      naturalWidth,
      naturalHeight
    }

    addSource(newSource)
    setSrcCols(dialogCols)
    setSrcRows(dialogRows)
    // n×m から決まる1フレームの出力サイズで出力設定を上書き
    applyFrameOutputSize(naturalWidth, naturalHeight, dialogCols, dialogRows)

    await new Promise(resolve => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          setIsDialogProcessing(false)
          // Remove current image from queue
          setPendingImages(prev => {
            const remaining = prev.slice(1)
            // If no more images, close dialog
            if (remaining.length === 0) {
              setShowSourceDialog(false)
            } else {
              // Reset dialog settings for next image (use its detected grid if available)
              setDialogCols(remaining[0].detectedCols ?? srcCols)
              setDialogRows(remaining[0].detectedRows ?? srcRows)
            }
            return remaining
          })
          resolve(undefined)
        }, 100)
      })
    })
  }

  const cancelSourceSettings = () => {
    // Remove current image and process next one
    setPendingImages(prev => {
      const remaining = prev.slice(1)
      if (remaining.length === 0) {
        setShowSourceDialog(false)
      } else {
        // Reset dialog settings for next image (use its detected grid if available)
        setDialogCols(remaining[0].detectedCols ?? srcCols)
        setDialogRows(remaining[0].detectedRows ?? srcRows)
      }
      return remaining
    })
  }

  // Video sampling dialog handling
  const confirmVideoSampling = async () => {
    const file = pendingVideos[0]
    if (!file) return
    // キューから外してダイアログを閉じ、抽出は進捗モーダルを出しながら実行する
    setPendingVideos(prev => prev.slice(1))
    await handleVideoUpload(file)
  }

  const cancelVideoSampling = () => {
    setPendingVideos(prev => prev.slice(1))
  }

  // Process sprites
  const handleProcessSprites = async () => {
    const result = await processSprites({
      sourceImages,
      selectedFrames,
      targetWidth,
      targetHeight,
      outputCols,
      outputFormat: outputFormat === 'gif' ? 'png' : outputFormat,
      removeBackground,
      backgroundTolerance,
      edgeErosion,
      bgColorSource,
      fillInterior
    })
    setProcessedImageUrl(result)
  }

  // Settings management
  const handleSaveSettings = () => {
    saveSettingsToFile({
      srcCols,
      srcRows,
      targetWidth,
      targetHeight,
      fps
    })
  }

  const handleLoadSettings = () => {
    const input = document.getElementById('settings-file-input') as HTMLInputElement
    const file = input?.files?.[0]
    if (!file) return

    loadSettingsFromFile(file)
      .then((settings) => {
        if (settings.srcCols) setSrcCols(settings.srcCols)
        if (settings.srcRows) setSrcRows(settings.srcRows)
        if (settings.targetWidth) setTargetWidth(settings.targetWidth)
        if (settings.targetHeight) setTargetHeight(settings.targetHeight)
        if (settings.fps) setFps(settings.fps)
      })
      .catch((error) => {
        console.error('Failed to load settings:', error)
      })
  }

  const handleResetSettings = () => {
    const defaults = getDefaultSettings()
    setSrcCols(defaults.srcCols)
    setSrcRows(defaults.srcRows)
    setTargetWidth(defaults.targetWidth)
    setTargetHeight(defaults.targetHeight)
    setFps(defaults.fps)
  }

  const handleLockAspectRatioChange = useCallback((locked: boolean, currentRatio: number) => {
    if (locked) {
      lockedAspectRatioRef.current = currentRatio
    }
    setLockAspectRatio(locked)
  }, [])

  const handleDownload = async () => {
    if (!processedImageUrl) return

    if (outputFormat === 'gif') {
      setIsEncodingGif(true)
      setGifProgress({ current: 0, total: selectedFrames.length })
      try {
        const gifUrl = await exportAnimatedGif({
          sourceImages,
          selectedFrames,
          targetWidth,
          targetHeight,
          fps,
          removeBackground,
          backgroundTolerance,
          edgeErosion,
          bgColorSource,
          fillInterior,
          onProgress: (current, total) => {
            setGifProgress({ current, total })
          }
        })
        if (gifUrl) {
          downloadImage(gifUrl, 'sprite-animation.gif')
          URL.revokeObjectURL(gifUrl)
        }
      } catch (error) {
        console.error('Failed to encode GIF:', error)
      } finally {
        setIsEncodingGif(false)
      }
    } else {
      const ext = outputFormat === 'webp' ? 'webp' : 'png'
      downloadImage(processedImageUrl, `sprite-sheet-pixel-art.${ext}`)
    }
  }

  return (
    <div className="app">
      <Header
        onSaveSettings={handleSaveSettings}
        onLoadSettings={handleLoadSettings}
        onResetSettings={handleResetSettings}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/mp4,video/quicktime"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
        disabled={isProcessingVideo}
        multiple
      />

      {isProcessingVideo && <VideoProgressModal progress={videoProgress} />}
      {isEncodingGif && <VideoProgressModal progress={gifProgress} />}

      {pendingVideo && !isProcessingVideo && (
        <VideoSamplingDialog
          fileName={pendingVideo.name}
          quality={frameSamplingQuality}
          pendingCount={pendingVideos.length}
          onChange={setFrameSamplingQuality}
          onConfirm={confirmVideoSampling}
          onCancel={cancelVideoSampling}
        />
      )}

      {showSourceDialog && pendingImage && !pendingVideo && (
        <SourceSettingsDialog
          pendingImage={pendingImage}
          dialogCols={dialogCols}
          dialogRows={dialogRows}
          isProcessing={isDialogProcessing}
          pendingCount={pendingImages.length}
          onColsChange={setDialogCols}
          onRowsChange={setDialogRows}
          onConfirm={confirmSourceSettings}
          onCancel={cancelSourceSettings}
        />
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
            <OutputSettings
              targetWidth={targetWidth}
              targetHeight={targetHeight}
              lockAspectRatio={lockAspectRatio}
              outputCols={outputCols}
              outputFormat={outputFormat}
              selectedFrameCount={selectedCount}
              onWidthChange={setTargetWidth}
              onHeightChange={setTargetHeight}
              onLockAspectRatioChange={handleLockAspectRatioChange}
              onOutputColsChange={setOutputCols}
              onOutputFormatChange={setOutputFormat}
            />

            <BackgroundRemovalSettings
              removeBackground={removeBackground}
              backgroundTolerance={backgroundTolerance}
              edgeErosion={edgeErosion}
              bgColorSource={bgColorSource}
              fillInterior={fillInterior}
              hasSourceImages={sourceImages.length > 0}
              onRemoveBackgroundChange={setRemoveBackground}
              onToleranceChange={setBackgroundTolerance}
              onEdgeErosionChange={setEdgeErosion}
              onBgColorSourceChange={setBgColorSource}
              onFillInteriorChange={setFillInterior}
              onProcess={handleProcessSprites}
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      {sourceImages.length > 0 ? (
        <div className="main-content">
          <FrameGrid
            sourceImages={sourceImages}
            frames={frames}
            isGeneratingFrames={isGeneratingFrames}
            selectedCount={selectedCount}
            totalCount={totalCount}
            onToggleFrame={toggleFrame}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
            onUpdateSourceSettings={handleUpdateSourceSettings}
            onRemoveSource={removeSource}
          />

          {processedImageUrl && (
            <ResultsPanel
              processedImageUrl={processedImageUrl}
              isPlaying={isPlaying}
              isReversed={isReversed}
              fps={fps}
              outputFormat={outputFormat}
              isEncodingGif={isEncodingGif}
              animationCanvasRef={animationCanvasRef}
              onDownload={handleDownload}
              onTogglePlayback={togglePlayback}
              onToggleReverse={toggleReverse}
              onFpsChange={setFps}
            />
          )}
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  )
}

export default App
