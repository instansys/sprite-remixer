import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

import type {
  PendingImage,
  FrameSamplingQuality,
  OutputFormat,
  VideoProgress,
  SourceImage,
  ResolutionRecommendation,
  CropMargins
} from './types'
import type { BackgroundColorSource } from './imageProcessing'
import { getPixelSnapResolutionRecommendations } from './imageProcessing'
import { buildStablePixelSnapTargetForSource } from './utils/pixelSnapTargets'
import { STORAGE_KEYS, DEFAULT_SETTINGS } from './constants'
import {
  useLocalStorage,
  useLocalStorageString,
  useLocalStorageBoolean,
  useFrameSelection,
  useAnimation,
  useSourceImages
} from './hooks'
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
  exportAnimatedGifFromSpriteSheet,
  detectSpriteGrid
} from './utils'
import {
  DEFAULT_CROP_MARGINS,
  areCropMarginsEqual,
  cropSpriteSheet,
  detectSpriteSheetAlphaCrop,
  getCroppedFrameSize,
  isCropMarginsEmpty,
  normalizeCropMargins,
  resolveSpriteSheetOutputCols
} from './utils/crop'

// 画像の自然寸法を取得する
function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = src
  })
}

function sameRecommendations(
  a: ResolutionRecommendation[],
  b: ResolutionRecommendation[]
): boolean {
  return a.length === b.length && a.every((item, index) => {
    const other = b[index]
    return other &&
      item.label === other.label &&
      item.width === other.width &&
      item.height === other.height &&
      item.scale === other.scale &&
      item.logicalWidth === other.logicalWidth &&
      item.logicalHeight === other.logicalHeight
  })
}

type RasterOutputFormat = Exclude<OutputFormat, 'gif'>

interface ProcessedSpriteSheetInfo {
  imageUrl: string
  frameWidth: number
  frameHeight: number
  frameCount: number
  outputCols: number
  imageFormat: RasterOutputFormat
}

interface PreviewSpriteSheetInfo extends ProcessedSpriteSheetInfo {
  sourceImageUrl: string
  crop: CropMargins
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
  const [pixelPerfectResize, setPixelPerfectResize] = useLocalStorageBoolean(
    STORAGE_KEYS.pixelPerfectResize,
    DEFAULT_SETTINGS.pixelPerfectResize
  )
  const [flipHorizontal, setFlipHorizontal] = useLocalStorageBoolean(
    STORAGE_KEYS.flipHorizontal,
    DEFAULT_SETTINGS.flipHorizontal
  )
  const [fps, setFps] = useLocalStorage(STORAGE_KEYS.fps, DEFAULT_SETTINGS.fps)
  const [previewBgColor, setPreviewBgColor] = useLocalStorageString<string>(
    STORAGE_KEYS.previewBgColor,
    DEFAULT_SETTINGS.previewBgColor
  )
  const [frameSamplingQuality, setFrameSamplingQuality] = useLocalStorageString<FrameSamplingQuality>(
    STORAGE_KEYS.frameSamplingQuality,
    DEFAULT_SETTINGS.frameSamplingQuality
  )

  // Crop settings for the completed sprite sheet
  const [cropMargins, setCropMargins] = useState<CropMargins>(() => ({ ...DEFAULT_CROP_MARGINS }))
  const [previewSpriteSheet, setPreviewSpriteSheet] = useState<PreviewSpriteSheetInfo | null>(null)
  const [isDetectingCrop, setIsDetectingCrop] = useState(false)

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
  const [processedSheetInfo, setProcessedSheetInfo] = useState<ProcessedSpriteSheetInfo | null>(null)
  const [resolutionRecommendations, setResolutionRecommendations] = useState<ResolutionRecommendation[]>([])
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

  const processedFrameWidth = processedSheetInfo?.frameWidth ?? targetWidth
  const processedFrameHeight = processedSheetInfo?.frameHeight ?? targetHeight
  const normalizedCropMargins = useMemo(
    () => normalizeCropMargins(cropMargins, processedFrameWidth, processedFrameHeight),
    [
      cropMargins,
      processedFrameWidth,
      processedFrameHeight
    ]
  )
  const croppedFrameSize = useMemo(
    () => getCroppedFrameSize(normalizedCropMargins, processedFrameWidth, processedFrameHeight),
    [normalizedCropMargins, processedFrameWidth, processedFrameHeight]
  )
  const activeSpriteSheet = useMemo<PreviewSpriteSheetInfo | null>(() => {
    if (!processedSheetInfo) return null

    if (
      previewSpriteSheet &&
      previewSpriteSheet.sourceImageUrl === processedSheetInfo.imageUrl &&
      areCropMarginsEqual(previewSpriteSheet.crop, normalizedCropMargins)
    ) {
      return previewSpriteSheet
    }

    return {
      ...processedSheetInfo,
      sourceImageUrl: processedSheetInfo.imageUrl,
      crop: { ...DEFAULT_CROP_MARGINS }
    }
  }, [processedSheetInfo, previewSpriteSheet, normalizedCropMargins])

  const {
    isPlaying,
    isReversed,
    togglePlayback,
    toggleReverse,
    canvasRef: animationCanvasRef
  } = useAnimation({
    processedImageUrl: activeSpriteSheet?.imageUrl ?? null,
    frameCount: activeSpriteSheet?.frameCount ?? 0,
    fps,
    targetWidth: activeSpriteSheet?.frameWidth ?? targetWidth,
    targetHeight: activeSpriteSheet?.frameHeight ?? targetHeight,
    outputCols: activeSpriteSheet?.outputCols ?? outputCols
  })

  const createPreviewSpriteSheet = useCallback(async (
    crop: CropMargins
  ): Promise<PreviewSpriteSheetInfo | null> => {
    if (!processedSheetInfo) return null

    const normalizedCrop = normalizeCropMargins(
      crop,
      processedSheetInfo.frameWidth,
      processedSheetInfo.frameHeight
    )
    const frameSize = getCroppedFrameSize(
      normalizedCrop,
      processedSheetInfo.frameWidth,
      processedSheetInfo.frameHeight
    )
    const imageFormat: RasterOutputFormat = outputFormat === 'gif' ? 'png' : outputFormat
    const canReuseOriginal = isCropMarginsEmpty(normalizedCrop) &&
      imageFormat === processedSheetInfo.imageFormat

    const imageUrl = canReuseOriginal
      ? processedSheetInfo.imageUrl
      : await cropSpriteSheet({
          imageUrl: processedSheetInfo.imageUrl,
          frameWidth: processedSheetInfo.frameWidth,
          frameHeight: processedSheetInfo.frameHeight,
          frameCount: processedSheetInfo.frameCount,
          outputCols: processedSheetInfo.outputCols,
          crop: normalizedCrop,
          outputFormat: imageFormat,
          preserveOriginalWhenUncropped: false
        })

    if (!imageUrl) return null

    return {
      sourceImageUrl: processedSheetInfo.imageUrl,
      imageUrl,
      frameWidth: frameSize.width,
      frameHeight: frameSize.height,
      frameCount: processedSheetInfo.frameCount,
      outputCols: processedSheetInfo.outputCols,
      imageFormat,
      crop: normalizedCrop
    }
  }, [processedSheetInfo, outputFormat])

  useEffect(() => {
    setCropMargins(prev => {
      const next = normalizeCropMargins(prev, processedFrameWidth, processedFrameHeight)
      return areCropMarginsEqual(prev, next) ? prev : next
    })
  }, [processedFrameWidth, processedFrameHeight])

  useEffect(() => {
    let cancelled = false

    createPreviewSpriteSheet(normalizedCropMargins)
      .then((sheet) => {
        if (!cancelled) {
          setPreviewSpriteSheet(sheet)
        }
      })
      .catch((error) => {
        console.error('Failed to crop sprite sheet:', error)
        if (!cancelled) {
          setPreviewSpriteSheet(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [createPreviewSpriteSheet, normalizedCropMargins])

  // Aspect ratio handling
  const prevTargetWidthRef = useRef(targetWidth)
  useEffect(() => {
    if (lockAspectRatio && prevTargetWidthRef.current !== targetWidth) {
      const newHeight = Math.max(8, Math.round(targetWidth * lockedAspectRatioRef.current))
      setTargetHeight(newHeight)
    }
    prevTargetWidthRef.current = targetWidth
  }, [targetWidth, lockAspectRatio, setTargetHeight])

  useEffect(() => {
    let cancelled = false

    const updateRecommendations = async () => {
      const frame = selectedFrames[0] ?? frames[0]
      const source = frame ? sourceImages[frame.sourceIndex] : null

      if (!frame || !source) {
        setResolutionRecommendations(prev => prev.length === 0 ? prev : [])
        return
      }

      try {
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = reject
          img.src = source.imageUrl
        })

        if (cancelled) return

        const frameWidth = img.width / source.cols
        const frameHeight = img.height / source.rows
        const canvas = document.createElement('canvas')
        canvas.width = frameWidth
        canvas.height = frameHeight
        const ctx = canvas.getContext('2d', {
          alpha: true,
          colorSpace: 'srgb',
          willReadFrequently: true
        })

        if (!ctx) {
          setResolutionRecommendations(prev => prev.length === 0 ? prev : [])
          return
        }

        ctx.imageSmoothingEnabled = false
        ctx.drawImage(
          img,
          frame.x * frameWidth,
          frame.y * frameHeight,
          frameWidth,
          frameHeight,
          0,
          0,
          frameWidth,
          frameHeight
        )

        const sourceFrames = selectedFrames.some(selectedFrame => selectedFrame.sourceIndex === frame.sourceIndex)
          ? selectedFrames.filter(selectedFrame => selectedFrame.sourceIndex === frame.sourceIndex)
          : frames.filter(candidateFrame => candidateFrame.sourceIndex === frame.sourceIndex)
        const stableTarget = buildStablePixelSnapTargetForSource(source, sourceFrames, img)
        const recommendations = stableTarget
          ? [1, 2, 4].map(scale => ({
              label: `${scale}x`,
              width: Math.max(8, stableTarget.logicalWidth * scale),
              height: Math.max(8, stableTarget.logicalHeight * scale),
              scale,
              logicalWidth: stableTarget.logicalWidth,
              logicalHeight: stableTarget.logicalHeight
            }))
          : getPixelSnapResolutionRecommendations(canvas)
        if (!cancelled) {
          setResolutionRecommendations(prev => (
            sameRecommendations(prev, recommendations) ? prev : recommendations
          ))
        }
      } catch (error) {
        console.error('Failed to calculate pixel snap recommendations:', error)
        if (!cancelled) {
          setResolutionRecommendations(prev => prev.length === 0 ? prev : [])
        }
      }
    }

    updateRecommendations()

    return () => {
      cancelled = true
    }
  }, [frames, selectedFrames, sourceImages])

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
      fillInterior,
      pixelPerfectResize,
      flipHorizontal
    })
    if (!result) {
      setProcessedSheetInfo(null)
      setPreviewSpriteSheet(null)
      return
    }

    setProcessedSheetInfo({
      imageUrl: result,
      frameWidth: targetWidth,
      frameHeight: targetHeight,
      frameCount: selectedFrames.length,
      outputCols,
      imageFormat: outputFormat === 'gif' ? 'png' : outputFormat
    })
    setPreviewSpriteSheet(null)
  }

  // Settings management
  const handleSaveSettings = () => {
    saveSettingsToFile({
      srcCols,
      srcRows,
      targetWidth,
      targetHeight,
      pixelPerfectResize,
      flipHorizontal,
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
        if (typeof settings.pixelPerfectResize === 'boolean') {
          setPixelPerfectResize(settings.pixelPerfectResize)
        }
        if (typeof settings.flipHorizontal === 'boolean') {
          setFlipHorizontal(settings.flipHorizontal)
        }
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
    setPixelPerfectResize(defaults.pixelPerfectResize)
    setFlipHorizontal(defaults.flipHorizontal)
    setFps(defaults.fps)
  }

  const handleLockAspectRatioChange = useCallback((locked: boolean, currentRatio: number) => {
    if (locked) {
      lockedAspectRatioRef.current = currentRatio
    }
    setLockAspectRatio(locked)
  }, [])

  const handleCropChange = useCallback((side: keyof CropMargins, value: number) => {
    setCropMargins(prev => normalizeCropMargins({
      ...prev,
      [side]: value
    }, processedFrameWidth, processedFrameHeight))
  }, [processedFrameWidth, processedFrameHeight])

  const handleResetCrop = useCallback(() => {
    setCropMargins({ ...DEFAULT_CROP_MARGINS })
  }, [])

  const handleAutoCrop = useCallback(async () => {
    if (!processedSheetInfo) return

    setIsDetectingCrop(true)
    try {
      const detectedCrop = await detectSpriteSheetAlphaCrop({
        imageUrl: processedSheetInfo.imageUrl,
        frameWidth: processedSheetInfo.frameWidth,
        frameHeight: processedSheetInfo.frameHeight,
        frameCount: processedSheetInfo.frameCount,
        outputCols: processedSheetInfo.outputCols
      })
      setCropMargins(detectedCrop)
    } catch (error) {
      console.error('Failed to detect sprite crop:', error)
    } finally {
      setIsDetectingCrop(false)
    }
  }, [processedSheetInfo])

  const handleDownload = async () => {
    if (!processedSheetInfo) return

    const outputSheet = await createPreviewSpriteSheet(normalizedCropMargins)
    if (!outputSheet) return

    if (outputFormat === 'gif') {
      setIsEncodingGif(true)
      setGifProgress({ current: 0, total: outputSheet.frameCount })
      try {
        const gifUrl = await exportAnimatedGifFromSpriteSheet({
          spriteSheetUrl: outputSheet.imageUrl,
          frameWidth: outputSheet.frameWidth,
          frameHeight: outputSheet.frameHeight,
          frameCount: outputSheet.frameCount,
          outputCols: outputSheet.outputCols,
          fps,
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
      downloadImage(outputSheet.imageUrl, `sprite-sheet-pixel-art.${ext}`)
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
              pixelPerfectResize={pixelPerfectResize}
              flipHorizontal={flipHorizontal}
              resolutionRecommendations={resolutionRecommendations}
              selectedFrameCount={selectedCount}
              onWidthChange={setTargetWidth}
              onHeightChange={setTargetHeight}
              onLockAspectRatioChange={handleLockAspectRatioChange}
              onOutputColsChange={setOutputCols}
              onOutputFormatChange={setOutputFormat}
              onPixelPerfectResizeChange={setPixelPerfectResize}
              onFlipHorizontalChange={setFlipHorizontal}
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

          {processedSheetInfo && activeSpriteSheet && (
            <ResultsPanel
              processedImageUrl={activeSpriteSheet.imageUrl}
              cropPreviewImageUrl={processedSheetInfo.imageUrl}
              sourceFrameWidth={processedSheetInfo.frameWidth}
              sourceFrameHeight={processedSheetInfo.frameHeight}
              sourceSheetCols={resolveSpriteSheetOutputCols(
                processedSheetInfo.outputCols,
                processedSheetInfo.frameCount
              )}
              croppedFrameWidth={croppedFrameSize.width}
              croppedFrameHeight={croppedFrameSize.height}
              cropMargins={normalizedCropMargins}
              isPlaying={isPlaying}
              isReversed={isReversed}
              fps={fps}
              outputFormat={outputFormat}
              isEncodingGif={isEncodingGif}
              animationCanvasRef={animationCanvasRef}
              previewBgColor={previewBgColor}
              onDownload={handleDownload}
              onCropChange={handleCropChange}
              onAutoCrop={handleAutoCrop}
              onResetCrop={handleResetCrop}
              onTogglePlayback={togglePlayback}
              onToggleReverse={toggleReverse}
              onFpsChange={setFps}
              onPreviewBgColorChange={setPreviewBgColor}
              isDetectingCrop={isDetectingCrop}
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
