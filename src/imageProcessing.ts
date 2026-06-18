import type { OutputFormat } from './types'

export interface ImageProcessingOptions {
  removeBackground?: boolean
  backgroundTolerance?: number
  edgeErosion?: number
}

interface GridConfig {
  peakThresholdMultiplier: number
  peakDistanceFilter: number
  walkerSearchWindowRatio: number
  walkerMinSearchWindow: number
  walkerStrengthThreshold: number
  minCutsPerAxis: number
  fallbackTargetSegments: number
  maxStepRatio: number
}

export interface PixelSnapAnalysis {
  logicalWidth: number
  logicalHeight: number
  pixelSizeX: number
  pixelSizeY: number
  detected: boolean
}

export interface PixelSnapTarget {
  logicalWidth: number
  logicalHeight: number
}

export interface ResolutionRecommendation {
  label: string
  width: number
  height: number
  scale: number
  logicalWidth: number
  logicalHeight: number
}

const PIXEL_SNAP_CONFIG: GridConfig = {
  peakThresholdMultiplier: 0.2,
  peakDistanceFilter: 4,
  walkerSearchWindowRatio: 0.35,
  walkerMinSearchWindow: 2,
  walkerStrengthThreshold: 0.5,
  minCutsPerAxis: 4,
  fallbackTargetSegments: 64,
  maxStepRatio: 1.8
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

const BACKGROUND_CLUSTER_DISTANCE = 24

interface BackgroundSample {
  r: number
  g: number
  b: number
  alpha: number
  sideMask: number
  cornerMask: number
  edgeDistance: number
}

interface BackgroundCluster {
  r: number
  g: number
  b: number
  weight: number
  outerWeight: number
  sideMask: number
  cornerMask: number
}

function countBits(value: number): number {
  let count = 0
  let current = value
  while (current > 0) {
    count += current & 1
    current >>= 1
  }
  return count
}

function getCornerMask(x: number, y: number, width: number, height: number, radius: number): number {
  let mask = 0
  if (x < radius && y < radius) mask |= 1
  if (x >= width - radius && y < radius) mask |= 2
  if (x < radius && y >= height - radius) mask |= 4
  if (x >= width - radius && y >= height - radius) mask |= 8
  return mask
}

function collectBackgroundSamples(imageData: ImageData, width: number, height: number): BackgroundSample[] {
  const samplesByPixel = new Map<number, BackgroundSample>()
  const minDimension = Math.min(width, height)
  const edgeDepth = Math.max(1, Math.min(6, Math.floor(minDimension / 12)))
  const cornerRadius = Math.max(1, Math.min(4, Math.floor(minDimension / 16)))

  const recordSample = (x: number, y: number, sideMask: number, edgeDistance: number) => {
    const pixelKey = y * width + x
    const idx = pixelKey * 4
    const alpha = imageData.data[idx + 3]
    if (alpha <= 8) return

    const existing = samplesByPixel.get(pixelKey)
    if (existing) {
      existing.sideMask |= sideMask
      existing.cornerMask |= getCornerMask(x, y, width, height, cornerRadius)
      existing.edgeDistance = Math.min(existing.edgeDistance, edgeDistance)
      return
    }

    samplesByPixel.set(pixelKey, {
      r: imageData.data[idx],
      g: imageData.data[idx + 1],
      b: imageData.data[idx + 2],
      alpha,
      sideMask,
      cornerMask: getCornerMask(x, y, width, height, cornerRadius),
      edgeDistance
    })
  }

  for (let depth = 0; depth < edgeDepth; depth++) {
    const topY = depth
    const bottomY = height - 1 - depth
    for (let x = 0; x < width; x++) {
      recordSample(x, topY, 1, depth)
      if (bottomY !== topY) recordSample(x, bottomY, 4, depth)
    }

    const leftX = depth
    const rightX = width - 1 - depth
    for (let y = 0; y < height; y++) {
      recordSample(leftX, y, 8, depth)
      if (rightX !== leftX) recordSample(rightX, y, 2, depth)
    }
  }

  return Array.from(samplesByPixel.values())
}

function findNearestBackgroundCluster(
  clusters: BackgroundCluster[],
  sample: BackgroundSample
): BackgroundCluster | null {
  const maxDistance = BACKGROUND_CLUSTER_DISTANCE * BACKGROUND_CLUSTER_DISTANCE
  let bestCluster: BackgroundCluster | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const cluster of clusters) {
    const dr = sample.r - cluster.r
    const dg = sample.g - cluster.g
    const db = sample.b - cluster.b
    const distance = dr * dr + dg * dg + db * db

    if (distance <= maxDistance && distance < bestDistance) {
      bestDistance = distance
      bestCluster = cluster
    }
  }

  return bestCluster
}

function detectAutoBackgroundColor(imageData: ImageData, width: number, height: number): number[] {
  const samples = collectBackgroundSamples(imageData, width, height)
  if (samples.length === 0) return [0, 0, 0]

  const clusters: BackgroundCluster[] = []

  for (const sample of samples) {
    const alphaWeight = sample.alpha / 255
    const edgeWeight = sample.edgeDistance === 0 ? 2 : 1
    const cornerWeight = sample.cornerMask === 0 ? 1 : 1.5
    const sampleWeight = alphaWeight * edgeWeight * cornerWeight
    const cluster = findNearestBackgroundCluster(clusters, sample)

    if (!cluster) {
      clusters.push({
        r: sample.r,
        g: sample.g,
        b: sample.b,
        weight: sampleWeight,
        outerWeight: sample.edgeDistance === 0 ? sampleWeight : 0,
        sideMask: sample.sideMask,
        cornerMask: sample.cornerMask
      })
      continue
    }

    const nextWeight = cluster.weight + sampleWeight
    cluster.r = (cluster.r * cluster.weight + sample.r * sampleWeight) / nextWeight
    cluster.g = (cluster.g * cluster.weight + sample.g * sampleWeight) / nextWeight
    cluster.b = (cluster.b * cluster.weight + sample.b * sampleWeight) / nextWeight
    cluster.weight = nextWeight
    cluster.outerWeight += sample.edgeDistance === 0 ? sampleWeight : 0
    cluster.sideMask |= sample.sideMask
    cluster.cornerMask |= sample.cornerMask
  }

  let bestCluster = clusters[0]
  let bestScore = -1
  const cornerEvidenceWeight = Math.max(12, samples.length * 0.015)

  for (const cluster of clusters) {
    const sideCoverage = countBits(cluster.sideMask)
    const cornerCoverage = countBits(cluster.cornerMask)
    const score =
      cluster.weight * (1 + sideCoverage * 0.2) +
      cluster.outerWeight * 0.1 +
      cornerCoverage * cornerEvidenceWeight

    if (score > bestScore) {
      bestScore = score
      bestCluster = cluster
    }
  }

  return [
    Math.round(bestCluster.r),
    Math.round(bestCluster.g),
    Math.round(bestCluster.b)
  ]
}

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

  // 自動検出: 外周の完全一致ではなく、外周数pxの近似色クラスタと分布で背景色を推定する。
  return detectAutoBackgroundColor(imageData, width, height)
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
  colorSource: BackgroundColorSource = 'auto',
  fillInterior: boolean = false
): ImageData {
  const bgColor = detectBackgroundColor(imageData, width, height, colorSource)
  const result = new ImageData(width, height)

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

  if (fillInterior) {
    // 内部も透過: 全ピクセルをスキャンして色が近いものを透過
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        result.data[idx] = imageData.data[idx]
        result.data[idx + 1] = imageData.data[idx + 1]
        result.data[idx + 2] = imageData.data[idx + 2]

        if (isColorSimilar(idx)) {
          result.data[idx + 3] = 0 // 透過
        } else {
          result.data[idx + 3] = imageData.data[idx + 3]
        }
      }
    }
  } else {
    // フラッドフィル方式: 端からのみ透過
    const visited = new Set<number>()

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

function getOpaquePixelSamples(imageData: ImageData, maxSamples = 12000): number[][] {
  const samples: number[][] = []
  const totalPixels = imageData.width * imageData.height
  const step = Math.max(1, Math.floor(totalPixels / maxSamples))

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex += step) {
    const idx = pixelIndex * 4
    if (imageData.data[idx + 3] > 0) {
      samples.push([
        imageData.data[idx],
        imageData.data[idx + 1],
        imageData.data[idx + 2]
      ])
    }
  }

  return samples
}

function distanceSquared(pixel: number[], centroid: number[]): number {
  const dr = pixel[0] - centroid[0]
  const dg = pixel[1] - centroid[1]
  const db = pixel[2] - centroid[2]
  return dr * dr + dg * dg + db * db
}

function buildQuantizedImageData(imageData: ImageData, kColors = 16): ImageData {
  const samples = getOpaquePixelSamples(imageData)
  if (samples.length === 0) {
    return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
  }

  const k = Math.min(kColors, samples.length)
  const centroids: number[][] = [samples[0].slice()]

  while (centroids.length < k) {
    let farthestSample = samples[0]
    let farthestDistance = -1

    for (const sample of samples) {
      const nearestDistance = centroids.reduce(
        (best, centroid) => Math.min(best, distanceSquared(sample, centroid)),
        Number.POSITIVE_INFINITY
      )
      if (nearestDistance > farthestDistance) {
        farthestDistance = nearestDistance
        farthestSample = sample
      }
    }

    centroids.push(farthestSample.slice())
  }

  for (let iteration = 0; iteration < 12; iteration++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0])
    const counts = Array.from({ length: k }, () => 0)

    for (const sample of samples) {
      let bestIndex = 0
      let bestDistance = Number.POSITIVE_INFINITY

      for (let i = 0; i < centroids.length; i++) {
        const distance = distanceSquared(sample, centroids[i])
        if (distance < bestDistance) {
          bestDistance = distance
          bestIndex = i
        }
      }

      sums[bestIndex][0] += sample[0]
      sums[bestIndex][1] += sample[1]
      sums[bestIndex][2] += sample[2]
      counts[bestIndex]++
    }

    let maxMovement = 0
    for (let i = 0; i < k; i++) {
      if (counts[i] === 0) continue
      const next = [
        sums[i][0] / counts[i],
        sums[i][1] / counts[i],
        sums[i][2] / counts[i]
      ]
      maxMovement = Math.max(maxMovement, distanceSquared(centroids[i], next))
      centroids[i] = next
    }

    if (maxMovement < 0.01) break
  }

  const result = new ImageData(imageData.width, imageData.height)

  for (let idx = 0; idx < imageData.data.length; idx += 4) {
    const alpha = imageData.data[idx + 3]
    if (alpha === 0) {
      result.data[idx] = imageData.data[idx]
      result.data[idx + 1] = imageData.data[idx + 1]
      result.data[idx + 2] = imageData.data[idx + 2]
      result.data[idx + 3] = alpha
      continue
    }

    const pixel = [imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]]
    let bestCentroid = centroids[0]
    let bestDistance = Number.POSITIVE_INFINITY

    for (const centroid of centroids) {
      const distance = distanceSquared(pixel, centroid)
      if (distance < bestDistance) {
        bestDistance = distance
        bestCentroid = centroid
      }
    }

    result.data[idx] = Math.round(bestCentroid[0])
    result.data[idx + 1] = Math.round(bestCentroid[1])
    result.data[idx + 2] = Math.round(bestCentroid[2])
    result.data[idx + 3] = alpha
  }

  return result
}

function computeProfiles(imageData: ImageData): { cols: number[]; rows: number[] } {
  const { width, height, data } = imageData
  const cols = Array.from({ length: width }, () => 0)
  const rows = Array.from({ length: height }, () => 0)

  const gray = (x: number, y: number): number => {
    const idx = (y * width + x) * 4
    if (data[idx + 3] === 0) return 0
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
  }

  for (let y = 0; y < height; y++) {
    for (let x = 1; x < width - 1; x++) {
      cols[x] += Math.abs(gray(x + 1, y) - gray(x - 1, y))
    }
  }

  for (let x = 0; x < width; x++) {
    for (let y = 1; y < height - 1; y++) {
      rows[y] += Math.abs(gray(x, y + 1) - gray(x, y - 1))
    }
  }

  return { cols, rows }
}

function estimateStepSize(profile: number[], config: GridConfig): number | null {
  const maxValue = profile.reduce((max, value) => Math.max(max, value), 0)
  if (maxValue <= 0) return null

  const threshold = maxValue * config.peakThresholdMultiplier
  const peaks: number[] = []

  for (let i = 1; i < profile.length - 1; i++) {
    if (profile[i] > threshold && profile[i] > profile[i - 1] && profile[i] > profile[i + 1]) {
      peaks.push(i)
    }
  }

  if (peaks.length < 2) return null

  const cleanPeaks = [peaks[0]]
  for (const peak of peaks.slice(1)) {
    if (peak - cleanPeaks[cleanPeaks.length - 1] > config.peakDistanceFilter - 1) {
      cleanPeaks.push(peak)
    }
  }

  if (cleanPeaks.length < 2) return null

  const distances: number[] = []
  for (let i = 1; i < cleanPeaks.length; i++) {
    distances.push(cleanPeaks[i] - cleanPeaks[i - 1])
  }

  distances.sort((a, b) => a - b)
  const mid = Math.floor(distances.length / 2)
  return distances.length % 2 === 0
    ? (distances[mid - 1] + distances[mid]) / 2
    : distances[mid]
}

function resolveStepSizes(
  stepX: number | null,
  stepY: number | null,
  width: number,
  height: number,
  config: GridConfig
): { x: number; y: number; detected: boolean } {
  if (stepX && stepY) {
    return { x: stepX, y: stepY, detected: true }
  }

  if (stepX) {
    return { x: stepX, y: stepX, detected: true }
  }

  if (stepY) {
    return { x: stepY, y: stepY, detected: true }
  }

  const fallback = Math.max(1, Math.min(width, height) / config.fallbackTargetSegments)
  return { x: fallback, y: fallback, detected: false }
}

function sanitizeCuts(cuts: number[], limit: number): number[] {
  const result = cuts
    .map(value => Math.max(0, Math.min(limit, Math.round(value))))
    .concat([0, limit])
    .sort((a, b) => a - b)

  return Array.from(new Set(result))
}

function walkGrid(profile: number[], stepSize: number, limit: number, config: GridConfig): number[] {
  const cuts = [0]
  let currentPosition = 0
  const searchWindow = Math.max(
    stepSize * config.walkerSearchWindowRatio,
    config.walkerMinSearchWindow
  )
  const meanValue = profile.reduce((sum, value) => sum + value, 0) / Math.max(1, profile.length)

  while (currentPosition < limit) {
    const target = currentPosition + stepSize
    if (target >= limit) {
      cuts.push(limit)
      break
    }

    const start = Math.max(Math.floor(target - searchWindow), Math.floor(currentPosition + 1), 0)
    const end = Math.min(Math.ceil(target + searchWindow), limit - 1)

    if (end <= start) {
      currentPosition = target
      continue
    }

    let bestIndex = start
    let bestValue = -1
    for (let i = start; i <= end; i++) {
      if ((profile[i] ?? 0) > bestValue) {
        bestValue = profile[i] ?? 0
        bestIndex = i
      }
    }

    if (bestValue > meanValue * config.walkerStrengthThreshold) {
      cuts.push(bestIndex)
      currentPosition = bestIndex
    } else {
      cuts.push(Math.round(target))
      currentPosition = target
    }
  }

  return sanitizeCuts(cuts, limit)
}

function snapUniformCuts(
  profile: number[],
  limit: number,
  targetStep: number,
  config: GridConfig,
  minRequired: number
): number[] {
  if (limit <= 1) return [0, limit]

  let desiredCells = Number.isFinite(targetStep) && targetStep > 0
    ? Math.round(limit / targetStep)
    : 0
  desiredCells = Math.min(limit, Math.max(minRequired - 1, desiredCells, 1))

  const cellWidth = limit / desiredCells
  const searchWindow = Math.max(
    cellWidth * config.walkerSearchWindowRatio,
    config.walkerMinSearchWindow
  )
  const meanValue = profile.reduce((sum, value) => sum + value, 0) / Math.max(1, profile.length)
  const cuts = [0]

  for (let index = 1; index < desiredCells; index++) {
    const target = cellWidth * index
    const previous = cuts[cuts.length - 1]
    if (previous + 1 >= limit) break

    const start = Math.max(Math.floor(target - searchWindow), previous + 1, 0)
    const end = Math.min(Math.ceil(target + searchWindow), limit - 1)
    let bestIndex = start
    let bestValue = -1

    for (let i = start; i <= end; i++) {
      const value = profile[i] ?? 0
      if (value > bestValue) {
        bestValue = value
        bestIndex = i
      }
    }

    if (bestValue < meanValue * config.walkerStrengthThreshold) {
      bestIndex = Math.max(previous + 1, Math.min(limit - 1, Math.round(target)))
    }

    cuts.push(bestIndex)
  }

  cuts.push(limit)
  return sanitizeCuts(cuts, limit)
}

function buildUniformCellCuts(limit: number, cellCount: number): number[] {
  if (limit <= 1) return [0, limit]

  const desiredCells = Math.min(limit, Math.max(1, Math.round(cellCount)))
  const cuts = [0]

  for (let index = 1; index < desiredCells; index++) {
    const previous = cuts[cuts.length - 1]
    const remainingCuts = desiredCells - index
    const minIndex = previous + 1
    const maxIndex = limit - remainingCuts
    const next = Math.round((index * limit) / desiredCells)
    cuts.push(Math.max(minIndex, Math.min(maxIndex, next)))
  }

  cuts.push(limit)
  return cuts
}

function stabilizeCuts(
  profile: number[],
  cuts: number[],
  limit: number,
  siblingCuts: number[],
  siblingLimit: number,
  config: GridConfig
): number[] {
  const sanitized = sanitizeCuts(cuts, limit)
  const minRequired = Math.min(limit + 1, Math.max(2, config.minCutsPerAxis))
  const axisCells = sanitized.length - 1
  const siblingCells = siblingCuts.length - 1
  const siblingHasGrid = siblingLimit > 0 && siblingCells >= minRequired - 1
  const stepsSkewed = siblingHasGrid && axisCells > 0 && (() => {
    const axisStep = limit / axisCells
    const siblingStep = siblingLimit / siblingCells
    const ratio = axisStep / siblingStep
    return ratio > config.maxStepRatio || ratio < 1 / config.maxStepRatio
  })()

  if (sanitized.length >= minRequired && !stepsSkewed) {
    return sanitized
  }

  const targetStep = siblingHasGrid
    ? siblingLimit / siblingCells
    : limit / config.fallbackTargetSegments

  return snapUniformCuts(profile, limit, targetStep, config, minRequired)
}

function getGridCuts(
  imageData: ImageData,
  target?: PixelSnapTarget
): { cols: number[]; rows: number[]; analysis: PixelSnapAnalysis } {
  if (target) {
    const logicalWidth = Math.max(1, Math.min(imageData.width, Math.round(target.logicalWidth)))
    const logicalHeight = Math.max(1, Math.min(imageData.height, Math.round(target.logicalHeight)))
    return {
      cols: buildUniformCellCuts(imageData.width, logicalWidth),
      rows: buildUniformCellCuts(imageData.height, logicalHeight),
      analysis: {
        logicalWidth,
        logicalHeight,
        pixelSizeX: imageData.width / logicalWidth,
        pixelSizeY: imageData.height / logicalHeight,
        detected: true
      }
    }
  }

  const quantized = buildQuantizedImageData(imageData)
  const profiles = computeProfiles(quantized)
  const stepX = estimateStepSize(profiles.cols, PIXEL_SNAP_CONFIG)
  const stepY = estimateStepSize(profiles.rows, PIXEL_SNAP_CONFIG)
  const resolved = resolveStepSizes(stepX, stepY, imageData.width, imageData.height, PIXEL_SNAP_CONFIG)

  const rawCols = walkGrid(profiles.cols, resolved.x, imageData.width, PIXEL_SNAP_CONFIG)
  const rawRows = walkGrid(profiles.rows, resolved.y, imageData.height, PIXEL_SNAP_CONFIG)
  const cols = stabilizeCuts(
    profiles.cols,
    rawCols,
    imageData.width,
    rawRows,
    imageData.height,
    PIXEL_SNAP_CONFIG
  )
  const rows = stabilizeCuts(
    profiles.rows,
    rawRows,
    imageData.height,
    cols,
    imageData.width,
    PIXEL_SNAP_CONFIG
  )

  return {
    cols,
    rows,
    analysis: {
      logicalWidth: Math.max(1, cols.length - 1),
      logicalHeight: Math.max(1, rows.length - 1),
      pixelSizeX: resolved.x,
      pixelSizeY: resolved.y,
      detected: resolved.detected
    }
  }
}

function resampleToPixelGrid(imageData: ImageData, cols: number[], rows: number[]): HTMLCanvasElement {
  const quantized = buildQuantizedImageData(imageData)
  const outputWidth = Math.max(1, cols.length - 1)
  const outputHeight = Math.max(1, rows.length - 1)
  const output = new ImageData(outputWidth, outputHeight)

  for (let yIndex = 0; yIndex < rows.length - 1; yIndex++) {
    for (let xIndex = 0; xIndex < cols.length - 1; xIndex++) {
      const xs = cols[xIndex]
      const xe = cols[xIndex + 1]
      const ys = rows[yIndex]
      const ye = rows[yIndex + 1]
      const counts = new Map<string, { color: number[]; count: number }>()

      for (let y = ys; y < ye; y++) {
        for (let x = xs; x < xe; x++) {
          const sourceIdx = (y * quantized.width + x) * 4
          const color = [
            quantized.data[sourceIdx],
            quantized.data[sourceIdx + 1],
            quantized.data[sourceIdx + 2],
            quantized.data[sourceIdx + 3]
          ]
          const key = color.join(',')
          const current = counts.get(key)
          if (current) {
            current.count++
          } else {
            counts.set(key, { color, count: 1 })
          }
        }
      }

      const winner = Array.from(counts.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return a.color.join(',').localeCompare(b.color.join(','))
      })[0]
      const targetIdx = (yIndex * outputWidth + xIndex) * 4

      if (winner) {
        output.data[targetIdx] = winner.color[0]
        output.data[targetIdx + 1] = winner.color[1]
        output.data[targetIdx + 2] = winner.color[2]
        output.data[targetIdx + 3] = winner.color[3]
      }
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = outputWidth
  canvas.height = outputHeight
  const ctx = canvas.getContext('2d', {
    alpha: true,
    colorSpace: 'srgb',
    willReadFrequently: true
  })
  if (!ctx) {
    throw new Error('Failed to get canvas context')
  }

  ctx.putImageData(output, 0, 0)
  return canvas
}

export function analyzePixelSnapCanvas(sourceCanvas: HTMLCanvasElement): PixelSnapAnalysis {
  const ctx = sourceCanvas.getContext('2d', {
    alpha: true,
    colorSpace: 'srgb',
    willReadFrequently: true
  })
  if (!ctx || sourceCanvas.width < 3 || sourceCanvas.height < 3) {
    return {
      logicalWidth: sourceCanvas.width,
      logicalHeight: sourceCanvas.height,
      pixelSizeX: 1,
      pixelSizeY: 1,
      detected: false
    }
  }

  return getGridCuts(ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)).analysis
}

export function getPixelSnapResolutionRecommendations(
  sourceCanvas: HTMLCanvasElement
): ResolutionRecommendation[] {
  const analysis = analyzePixelSnapCanvas(sourceCanvas)
  return [1, 2, 4].map(scale => ({
    label: `${scale}x`,
    width: Math.max(8, analysis.logicalWidth * scale),
    height: Math.max(8, analysis.logicalHeight * scale),
    scale,
    logicalWidth: analysis.logicalWidth,
    logicalHeight: analysis.logicalHeight
  }))
}

export function scaleImageWithPixelSnap(
  sourceCanvas: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  pixelSnapTarget?: PixelSnapTarget
): HTMLCanvasElement {
  const ctx = sourceCanvas.getContext('2d', {
    alpha: true,
    colorSpace: 'srgb',
    willReadFrequently: true
  })

  if (!ctx || sourceCanvas.width < 3 || sourceCanvas.height < 3) {
    return scaleImageNearestNeighbor(sourceCanvas, targetWidth, targetHeight)
  }

  const imageData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
  const { cols, rows } = getGridCuts(imageData, pixelSnapTarget)
  const snappedCanvas = resampleToPixelGrid(imageData, cols, rows)

  return scaleImageNearestNeighbor(snappedCanvas, targetWidth, targetHeight)
}

export function flipCanvasHorizontal(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const flippedCanvas = document.createElement('canvas')
  flippedCanvas.width = sourceCanvas.width
  flippedCanvas.height = sourceCanvas.height
  const ctx = flippedCanvas.getContext('2d', {
    alpha: true,
    colorSpace: 'srgb',
    willReadFrequently: true
  })
  if (!ctx) {
    throw new Error('Failed to get canvas context')
  }

  ctx.imageSmoothingEnabled = false
  ctx.translate(sourceCanvas.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(sourceCanvas, 0, 0)

  return flippedCanvas
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
