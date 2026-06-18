// スプライトシートの n×m 分割を軽量に自動検出する。
//
// 考え方（ユーザー案）:
//  1. 画像を低解像度のグレースケール（アルファで重み付け）に変換する
//  2. 縦・横それぞれについて、分割数Cを総当たりで試す
//  3. 各分割で「同じフレーム内位置にあるピクセル」がC枚のフレーム間でどれだけ揃うか
//     （分散）を測る。揃っているほど = だいたい同じ位置に絵がある = その分割が正しい
//  4. フレーム内分散 / 全体分散 の比が最小の分割を採用（比なので分割数による偏りが出にくい）
//
// あくまでヒューリスティックなので、検出結果はダイアログの初期値として提示し、ユーザーが調整できる。

const WORK_MAX_EDGE = 192 // 検出に使う作業解像度の長辺上限
const MIN_FRAME_PX = 6 // 作業解像度上での1フレームの最小ピクセル
const MAX_COUNT = 16 // 各軸の最大分割数
const SAMPLES_PER_FRAME = 8 // フレーム内をいくつの位置でサンプリングするか
const ACCEPT_RATIO = 0.4 // この比未満なら「分割あり」と判定（超えたら1とみなす）

export interface DetectedGrid {
  cols: number
  rows: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// 作業用のグレースケール値配列（アルファで重み付け＝シルエットの周期性を拾いやすくする）を作る
function toWorkBuffer(img: HTMLImageElement): { data: Float32Array; w: number; h: number } | null {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (nw === 0 || nh === 0) return null

  const scale = Math.min(1, WORK_MAX_EDGE / Math.max(nw, nh))
  const w = Math.max(1, Math.round(nw * scale))
  const h = Math.max(1, Math.round(nh * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, w, h)

  const { data: rgba } = ctx.getImageData(0, 0, w, h)
  const data = new Float32Array(w * h)
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    const a = rgba[p + 3] / 255
    const gray = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]
    data[i] = gray * a
  }
  return { data, w, h }
}

// 1軸の分割数を検出する。getValue(along, across) で対象軸方向(along)と直交方向(across)の値を引く。
function detectAxis(
  alongSize: number,
  acrossSize: number,
  getValue: (along: number, across: number) => number
): number {
  let bestCount = 1
  let bestRatio = Infinity

  for (let count = 2; count <= MAX_COUNT; count++) {
    const frameLen = alongSize / count
    if (frameLen < MIN_FRAME_PX) break

    const su = Math.min(SAMPLES_PER_FRAME, Math.max(2, Math.round(frameLen)))

    let withinSum = 0 // フレーム内位置ごとの分散の合計
    let positions = 0
    let totalSum = 0
    let totalSumSq = 0
    let totalCount = 0

    for (let across = 0; across < acrossSize; across++) {
      for (let u = 0; u < su; u++) {
        const offset = (u + 0.5) / su
        // C枚のフレームから同じフレーム内位置の値を集める
        let mean = 0
        const vals: number[] = []
        for (let k = 0; k < count; k++) {
          const along = Math.min(alongSize - 1, Math.floor((k + offset) * frameLen))
          const v = getValue(along, across)
          vals.push(v)
          mean += v
          totalSum += v
          totalSumSq += v * v
          totalCount++
        }
        mean /= count
        let variance = 0
        for (const v of vals) variance += (v - mean) * (v - mean)
        variance /= count
        withinSum += variance
        positions++
      }
    }

    if (totalCount === 0 || positions === 0) continue
    const totalMean = totalSum / totalCount
    const totalVar = totalSumSq / totalCount - totalMean * totalMean
    if (totalVar <= 1e-6) continue // ほぼ無地 → 周期は判定不能

    const withinAvg = withinSum / positions
    const ratio = withinAvg / totalVar

    if (ratio < bestRatio - 1e-6) {
      bestRatio = ratio
      bestCount = count
    }
  }

  return bestRatio < ACCEPT_RATIO ? bestCount : 1
}

/**
 * スプライトシート画像から推定される列数・行数を返す。
 * 検出できない・無地などの場合は { cols: 1, rows: 1 }。
 */
export async function detectSpriteGrid(imageUrl: string): Promise<DetectedGrid> {
  try {
    const img = await loadImage(imageUrl)
    const buf = toWorkBuffer(img)
    if (!buf) return { cols: 1, rows: 1 }
    const { data, w, h } = buf

    const cols = detectAxis(w, h, (x, y) => data[y * w + x])
    const rows = detectAxis(h, w, (y, x) => data[y * w + x])

    return { cols, rows }
  } catch {
    return { cols: 1, rows: 1 }
  }
}
