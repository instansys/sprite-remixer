import type { OutputFormat } from './types'

export interface ImageProcessingOptions {
  removeBackground?: boolean
  backgroundTolerance?: number
  edgeErosion?: number
}

/**
 * RGBからLab色空間に変換（知覚的な色差を計算するため）
 */
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  // RGB to XYZ
  let rn = r / 255
  let gn = g / 255
  let bn = b / 255

  rn = rn > 0.04045 ? Math.pow((rn + 0.055) / 1.055, 2.4) : rn / 12.92
  gn = gn > 0.04045 ? Math.pow((gn + 0.055) / 1.055, 2.4) : gn / 12.92
  bn = bn > 0.04045 ? Math.pow((bn + 0.055) / 1.055, 2.4) : bn / 12.92

  rn *= 100
  gn *= 100
  bn *= 100

  const x = rn * 0.4124564 + gn * 0.3575761 + bn * 0.1804375
  const y = rn * 0.2126729 + gn * 0.7151522 + bn * 0.0721750
  const z = rn * 0.0193339 + gn * 0.1191920 + bn * 0.9503041

  // XYZ to Lab (D65 illuminant)
  const xn = 95.047
  const yn = 100.000
  const zn = 108.883

  let fx = x / xn
  let fy = y / yn
  let fz = z / zn

  const epsilon = 0.008856
  const kappa = 903.3

  fx = fx > epsilon ? Math.pow(fx, 1 / 3) : (kappa * fx + 16) / 116
  fy = fy > epsilon ? Math.pow(fy, 1 / 3) : (kappa * fy + 16) / 116
  fz = fz > epsilon ? Math.pow(fz, 1 / 3) : (kappa * fz + 16) / 116

  const L = 116 * fy - 16
  const a = 500 * (fx - fy)
  const bVal = 200 * (fy - fz)

  return [L, a, bVal]
}

/**
 * CIE76色差（ΔE）を計算
 * 人間の知覚に基づいた色の違いを測定
 * 一般的に ΔE < 2.3 は人間には区別できない
 */
function deltaE(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const [L1, a1, b1Lab] = rgbToLab(r1, g1, b1)
  const [L2, a2, b2Lab] = rgbToLab(r2, g2, b2)

  return Math.sqrt(
    Math.pow(L2 - L1, 2) +
    Math.pow(a2 - a1, 2) +
    Math.pow(b2Lab - b1Lab, 2)
  )
}

export const BackgroundColorSources = ['auto', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
export type BackgroundColorSource = typeof BackgroundColorSources[number]

/**
 * 指定した角のピクセル色を取得
 */
export function getCornerColor(imageData: ImageData, width: number, height: number, corner: BackgroundColorSource): number[] {
  let idx: number
  switch (corner) {
    case 'top-left':
      idx = 0
      break
    case 'top-right':
      idx = (width - 1) * 4
      break
    case 'bottom-left':
      idx = (height - 1) * width * 4
      break
    case 'bottom-right':
      idx = ((height - 1) * width + width - 1) * 4
      break
    default:
      idx = 0
  }
  return [imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]]
}

export function detectBackgroundColor(
  imageData: ImageData,
  width: number,
  height: number,
  source: BackgroundColorSource = 'auto'
): number[] {
  // 特定の角が指定されている場合はその色を返す
  if (source !== 'auto') {
    return getCornerColor(imageData, width, height, source)
  }

  // 自動検出: エッジ全体から最も多い色を検出
  const edgeColors: Map<string, number> = new Map()

  // Top and bottom edges
  for (let x = 0; x < width; x++) {
    const topIdx = x * 4
    const bottomIdx = ((height - 1) * width + x) * 4

    const topColor = `${imageData.data[topIdx]},${imageData.data[topIdx + 1]},${imageData.data[topIdx + 2]}`
    const bottomColor = `${imageData.data[bottomIdx]},${imageData.data[bottomIdx + 1]},${imageData.data[bottomIdx + 2]}`

    edgeColors.set(topColor, (edgeColors.get(topColor) || 0) + 1)
    edgeColors.set(bottomColor, (edgeColors.get(bottomColor) || 0) + 1)
  }

  // Left and right edges
  for (let y = 0; y < height; y++) {
    const leftIdx = y * width * 4
    const rightIdx = (y * width + width - 1) * 4

    const leftColor = `${imageData.data[leftIdx]},${imageData.data[leftIdx + 1]},${imageData.data[leftIdx + 2]}`
    const rightColor = `${imageData.data[rightIdx]},${imageData.data[rightIdx + 1]},${imageData.data[rightIdx + 2]}`

    edgeColors.set(leftColor, (edgeColors.get(leftColor) || 0) + 1)
    edgeColors.set(rightColor, (edgeColors.get(rightColor) || 0) + 1)
  }

  // Find most common edge color
  let maxCount = 0
  let bgColor = '0,0,0'

  edgeColors.forEach((count, color) => {
    if (count > maxCount) {
      maxCount = count
      bgColor = color
    }
  })

  return bgColor.split(',').map(c => parseInt(c))
}

/**
 * エッジ侵食: 不透明ピクセルの境界を指定回数だけ削る
 * 背景透過後に境界に残る背景色を除去するのに有効
 */
export function erodeEdges(
  imageData: ImageData,
  width: number,
  height: number,
  iterations: number = 1
): ImageData {
  if (iterations <= 0) return imageData

  let current = new Uint8ClampedArray(imageData.data)

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Uint8ClampedArray(current)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4

        // 既に透明ならスキップ
        if (current[idx + 3] === 0) continue

        // 隣接ピクセルに透明があるかチェック（8方向）
        let hasTranparentNeighbor = false
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy

            // 境界外は透明として扱う
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
              hasTranparentNeighbor = true
              break
            }

            const nIdx = (ny * width + nx) * 4
            if (current[nIdx + 3] === 0) {
              hasTranparentNeighbor = true
              break
            }
          }
          if (hasTranparentNeighbor) break
        }

        // 透明な隣接ピクセルがあれば、このピクセルを透明にする
        if (hasTranparentNeighbor) {
          next[idx + 3] = 0
        }
      }
    }

    current = next
  }

  const result = new ImageData(width, height)
  result.data.set(current)
  return result
}

export function removeBackgroundFromImage(
  imageData: ImageData,
  width: number,
  height: number,
  tolerance: number = 10,
  erosion: number = 0,
  colorSource: BackgroundColorSource = 'auto'
): ImageData {
  const bgColor = detectBackgroundColor(imageData, width, height, colorSource)
  const result = new ImageData(width, height)
  const visited = new Set<number>()

  // 知覚的色差（ΔE）を使った色類似度チェック
  // tolerance を ΔE スケールにマッピング（0-255 → 0-100）
  // ΔE < 2.3 は人間には区別できない、< 5 は近い色、< 10 は同系色
  const deltaEThreshold = (tolerance / 255) * 100

  const isColorSimilar = (idx: number): boolean => {
    const r = imageData.data[idx]
    const g = imageData.data[idx + 1]
    const b = imageData.data[idx + 2]

    const colorDiff = deltaE(r, g, b, bgColor[0], bgColor[1], bgColor[2])
    return colorDiff <= deltaEThreshold
  }
  
  // Flood fill from edges
  const floodFill = (startX: number, startY: number) => {
    const queue: [number, number][] = [[startX, startY]]
    
    while (queue.length > 0) {
      const [x, y] = queue.shift()!
      const idx = (y * width + x) * 4
      const pixelKey = y * width + x
      
      if (x < 0 || x >= width || y < 0 || y >= height || visited.has(pixelKey)) {
        continue
      }
      
      visited.add(pixelKey)
      
      if (isColorSimilar(idx)) {
        // Mark as transparent
        result.data[idx] = imageData.data[idx]
        result.data[idx + 1] = imageData.data[idx + 1]
        result.data[idx + 2] = imageData.data[idx + 2]
        result.data[idx + 3] = 0 // Set alpha to 0
        
        // Add neighbors
        queue.push([x + 1, y])
        queue.push([x - 1, y])
        queue.push([x, y + 1])
        queue.push([x, y - 1])
      } else {
        // Keep original pixel
        result.data[idx] = imageData.data[idx]
        result.data[idx + 1] = imageData.data[idx + 1]
        result.data[idx + 2] = imageData.data[idx + 2]
        result.data[idx + 3] = imageData.data[idx + 3]
      }
    }
  }
  
  // Start flood fill from all edges
  for (let x = 0; x < width; x++) {
    floodFill(x, 0) // Top edge
    floodFill(x, height - 1) // Bottom edge
  }
  for (let y = 0; y < height; y++) {
    floodFill(0, y) // Left edge
    floodFill(width - 1, y) // Right edge
  }
  
  // Copy remaining pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const pixelKey = y * width + x
      if (!visited.has(pixelKey)) {
        result.data[idx] = imageData.data[idx]
        result.data[idx + 1] = imageData.data[idx + 1]
        result.data[idx + 2] = imageData.data[idx + 2]
        result.data[idx + 3] = imageData.data[idx + 3]
      }
    }
  }

  // エッジ侵食を適用
  if (erosion > 0) {
    return erodeEdges(result, width, height, erosion)
  }

  return result
}

export function scaleImageNearestNeighbor(
  sourceCanvas: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number
): HTMLCanvasElement {
  const scaledCanvas = document.createElement('canvas')
  scaledCanvas.width = targetWidth
  scaledCanvas.height = targetHeight
  // Preserve color space and alpha channel
  const scaledCtx = scaledCanvas.getContext('2d', {
    alpha: true,
    colorSpace: 'srgb',
    willReadFrequently: true
  })

  if (!scaledCtx) {
    throw new Error('Failed to get canvas context')
  }

  // Ensure nearest neighbor scaling - disable all smoothing
  scaledCtx.imageSmoothingEnabled = false
  scaledCtx.imageSmoothingQuality = 'low'

  // Calculate aspect ratio preserving scale
  const sourceWidth = sourceCanvas.width
  const sourceHeight = sourceCanvas.height
  const sourceAspect = sourceWidth / sourceHeight
  const targetAspect = targetWidth / targetHeight

  let drawWidth: number
  let drawHeight: number
  let offsetX: number
  let offsetY: number

  if (sourceAspect > targetAspect) {
    // Source is wider - fit to width
    drawWidth = targetWidth
    drawHeight = Math.round(targetWidth / sourceAspect)
    offsetX = 0
    offsetY = Math.floor((targetHeight - drawHeight) / 2)
  } else if (sourceAspect < targetAspect) {
    // Source is taller - fit to height
    drawHeight = targetHeight
    drawWidth = Math.round(targetHeight * sourceAspect)
    offsetX = Math.floor((targetWidth - drawWidth) / 2)
    offsetY = 0
  } else {
    // Same aspect ratio - fill exactly
    drawWidth = targetWidth
    drawHeight = targetHeight
    offsetX = 0
    offsetY = 0
  }

  // Canvas is already transparent by default
  // Draw with nearest neighbor interpolation at the calculated position
  scaledCtx.drawImage(sourceCanvas, offsetX, offsetY, drawWidth, drawHeight)

  return scaledCanvas
}

export function exportCanvasAsPNG(canvas: HTMLCanvasElement): string {
  // Export as PNG with maximum quality
  // PNG is lossless, so quality parameter doesn't affect it
  return canvas.toDataURL('image/png')
}

export function exportCanvas(canvas: HTMLCanvasElement, format: OutputFormat): string {
  if (format === 'webp') {
    // WebP with maximum quality (1.0)
    return canvas.toDataURL('image/webp', 1.0)
  }
  // PNG is lossless
  return canvas.toDataURL('image/png')
}