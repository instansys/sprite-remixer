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
  FrameSamplingSelector,
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
  getDefaultSettings
} from './utils'

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

  // Processing state
  const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null)
  const [isProcessingVideo, setIsProcessingVideo] = useState(false)
  const [videoProgress, setVideoProgress] = useState<VideoProgress>({ current: 0, total: 0 })

  // Source dialog state
  const [showSourceDialog, setShowSourceDialog] = useState(false)
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null)
  const [dialogCols, setDialogCols] = useState(srcCols)
  const [dialogRows, setDialogRows] = useState(srcRows)
  const [isDialogProcessing, setIsDialogProcessing] = useState(false)

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
    togglePlayback,
    canvasRef: animationCanvasRef
  } = useAnimation({
    processedImageUrl,
    selectedFrames,
    fps,
    targetWidth,
    targetHeight,
    srcCols
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
        await handleVideoUpload(file)
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
      reader.onload = (event) => {
        const imageUrl = event.target?.result as string
        setPendingImage({ file, imageUrl })
        setDialogCols(srcCols)
        setDialogRows(srcRows)
        setShowSourceDialog(true)
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

  // Source dialog handling
  const confirmSourceSettings = async () => {
    if (!pendingImage) return

    setIsDialogProcessing(true)
    await new Promise(resolve => setTimeout(resolve, 0))

    const newSource: SourceImage = {
      id: generateSourceId(),
      name: pendingImage.file.name,
      imageUrl: pendingImage.imageUrl,
      cols: dialogCols,
      rows: dialogRows,
      sourceType: 'image'
    }

    addSource(newSource)
    setSrcCols(dialogCols)
    setSrcRows(dialogRows)

    await new Promise(resolve => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          setIsDialogProcessing(false)
          setShowSourceDialog(false)
          setPendingImage(null)
          resolve(undefined)
        }, 100)
      })
    })
  }

  const cancelSourceSettings = () => {
    setShowSourceDialog(false)
    setPendingImage(null)
  }

  // Process sprites
  const handleProcessSprites = async () => {
    const result = await processSprites({
      sourceImages,
      selectedFrames,
      targetWidth,
      targetHeight,
      outputCols,
      outputFormat,
      removeBackground,
      backgroundTolerance,
      edgeErosion,
      bgColorSource
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

  const handleDownload = () => {
    if (processedImageUrl) {
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

      {showSourceDialog && pendingImage && (
        <SourceSettingsDialog
          pendingImage={pendingImage}
          dialogCols={dialogCols}
          dialogRows={dialogRows}
          isProcessing={isDialogProcessing}
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

          <FrameSamplingSelector
            value={frameSamplingQuality}
            onChange={setFrameSamplingQuality}
            disabled={isProcessingVideo}
          />

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
              hasSourceImages={sourceImages.length > 0}
              onRemoveBackgroundChange={setRemoveBackground}
              onToleranceChange={setBackgroundTolerance}
              onEdgeErosionChange={setEdgeErosion}
              onBgColorSourceChange={setBgColorSource}
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
            onUpdateSourceSettings={updateSourceSettings}
            onRemoveSource={removeSource}
          />

          {processedImageUrl && (
            <ResultsPanel
              processedImageUrl={processedImageUrl}
              isPlaying={isPlaying}
              fps={fps}
              animationCanvasRef={animationCanvasRef}
              onDownload={handleDownload}
              onTogglePlayback={togglePlayback}
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
