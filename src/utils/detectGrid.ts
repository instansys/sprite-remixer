// スプライトシートの n×m 分割を軽量に自動検出する（隙間検出を主、周期性を従）。
//
// 方針:
//  1. 近傍縮小で作業バッファを作る（細いガターを潰さない）。透過があればアルファ、
//     なければ背景色からの距離を「コンテンツ存在量」とする。輝度(プリマルチプライ)も持つ。
//  2. 各軸でまず「規則的な空ガターで区切られた等幅の帯」を数える（隙間検出＝主）。
//     これはフレーム数を一意に与え、倍数の曖昧さが原理的に出ず、静止フレームでも効く。
//  3. 隙間が無いタイトなシートは周期性で判定（従）。元寸法を割り切る分割数のみ試し、
//     隣接フレーム差を「無相関位置の差」で正規化して画像非依存の閾値で判定する。
//  4. 倍数問題は、隙間ありなら実帯数を信頼、隙間無しなら同点時に最小の約数を選ぶ。
//
// あくまでヒューリスティックなので、結果はダイアログの初期値として提示し、ユーザーが調整できる。

const WORK_MAX_EDGE = 256
const MAX_COUNT = 16
const MIN_FRAME_PX = 6
const ALPHA_PRESENCE_FRAC = 0.01 // これ以上半透明画素があれば「アルファ有効」
const BG_DIST = 40 // 不透明時、背景からこの色距離で「完全にコンテンツ」とみなす
const EMPTY_FRAC = 0.06 // プロファイルが最大値のこの割合未満＝空（ガター）
const PITCH_CV_MAX = 0.18 // 帯ピッチの変動係数の上限（規則性チェック）
const WIDTH_TOL = 0.3 // 帯幅は中央値±30%以内であること
const ACCEPT_PERIOD = 0.72 // 隣接差/無相関差 がこれ未満なら周期ありと判定
const MIN_SEP = 0.12 // フレーム境界が輪郭の谷に乗っている度合いの最小値（過剰分割の抑止）
const MIN_BASE = 0.02 // 無相関差がこれ未満＝ほぼ無地 → 周期判定しない
const OCCAM = 0.03 // 分割数が多いほど僅かに不利にして過剰分割を抑える
const TIE_MARGIN = 0.06 // この差以内の同点なら小さい約数を採用（8→4）

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

interface WorkBuffer {
  content: Float32Array // 存在量 0..1（アルファ or 背景色距離）
  lum: Float32Array // プリマルチプライ輝度 0..1
  w: number
  h: number
  nw: number // 元画像の幅
  nh: number // 元画像の高さ
}

// 近傍サンプリングで縮小する（平滑化すると1pxガターが消えるため）
function buildWork(img: HTMLImageElement): WorkBuffer | null {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (!nw || !nh) return null

  const scale = Math.min(1, WORK_MAX_EDGE / Math.max(nw, nh))
  const w = Math.max(1, Math.round(nw * scale))
  const h = Math.max(1, Math.round(nh * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0, w, h)

  const rgba = ctx.getImageData(0, 0, w, h).data
  const n = w * h

  let semi = 0
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < 250) semi++
  const hasAlpha = semi > n * ALPHA_PRESENCE_FRAC

  const content = new Float32Array(n)
  const lum = new Float32Array(n)
  const bg = hasAlpha ? [0, 0, 0] : edgeMedian(rgba, w, h)

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const a = rgba[p + 3] / 255
    const lr = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]
    lum[i] = (lr / 255) * a
    if (hasAlpha) {
      content[i] = a
    } else {
      const dr = rgba[p] - bg[0]
      const dg = rgba[p + 1] - bg[1]
      const db = rgba[p + 2] - bg[2]
      content[i] = Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / BG_DIST)
    }
  }

  return { content, lum, w, h, nw, nh }
}

// 4辺の画素の中央値から背景色を推定する
function edgeMedian(rgba: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4
    rs.push(rgba[i])
    gs.push(rgba[i + 1])
    bs.push(rgba[i + 2])
  }
  for (let x = 0; x < w; x++) {
    push(x, 0)
    push(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    push(0, y)
    push(w - 1, y)
  }
  const med = (a: number[]) => {
    a.sort((p, q) => p - q)
    return a[a.length >> 1]
  }
  return [med(rs), med(gs), med(bs)]
}

// --- 主：規則的な空ガターで区切られた等幅の帯を数える ---
function detectByGaps(profile: Float64Array): number | null {
  const n = profile.length
  let max = 0
  for (let i = 0; i < n; i++) if (profile[i] > max) max = profile[i]
  if (max <= 1e-9) return null

  const thr = max * EMPTY_FRAC
  const bands: Array<{ s: number; e: number }> = []
  let i = 0
  while (i < n) {
    if (profile[i] > thr) {
      const s = i
      while (i < n && profile[i] > thr) i++
      bands.push({ s, e: i - 1 })
    } else {
      i++
    }
  }
  if (bands.length < 2) return null

  const widths = bands.map(b => b.e - b.s + 1)
  const centers = bands.map(b => (b.s + b.e) / 2)
  const medWidth = [...widths].sort((a, b) => a - b)[widths.length >> 1]
  if (medWidth < MIN_FRAME_PX) return null

  // 帯幅が不揃いなら規則グリッドではない（本物のコンテンツの可能性）
  for (const wd of widths) if (Math.abs(wd - medWidth) > WIDTH_TOL * medWidth) return null

  // ピッチ（中心間隔）の規則性
  const pitch: number[] = []
  for (let k = 1; k < centers.length; k++) pitch.push(centers[k] - centers[k - 1])
  const mp = pitch.reduce((a, b) => a + b, 0) / pitch.length
  const sd = Math.sqrt(pitch.reduce((a, p) => a + (p - mp) ** 2, 0) / pitch.length)
  if (mp <= 0 || sd / mp > PITCH_CV_MAX) return null

  return bands.length
}

type Get = (buf: Float32Array, along: number, across: number) => number

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))
  return sorted[i]
}

// フレーム境界（k*frame）が輪郭の谷（低存在量）に乗っている度合い。高いほど本物の境界。
function separatorEvidence(profile: Float64Array, count: number): number {
  const n = profile.length
  const frame = n / count
  const sortedAll = [...profile].sort((a, b) => a - b)
  const interior = Math.max(
    profile.reduce((a, b) => a + b, 0) / n,
    quantile(sortedAll, 0.75)
  )
  if (interior < 1e-5) return 0
  const win = Math.max(1, Math.floor(Math.min(3, frame * 0.08)))
  const vals: number[] = []
  for (let k = 1; k < count; k++) {
    const c = k * frame
    for (let x = Math.floor(c - win); x <= Math.ceil(c + win); x++) {
      if (x >= 0 && x < n) vals.push(profile[x])
    }
  }
  vals.sort((a, b) => a - b)
  const boundaryHigh = quantile(vals, 0.8) // 境界付近でも高めの値（谷でない箇所をはじく）
  return Math.max(0, Math.min(1, (interior - boundaryHigh) / interior))
}

// --- 従：割り切れる分割数のみ試し、隣接フレーム差を無相関位置の差で正規化する ---
function detectByPeriod(
  content: Float32Array,
  lum: Float32Array,
  profile: Float64Array,
  alongLen: number,
  acrossLen: number,
  origAlong: number,
  get: Get
): number {
  const diff = (a1: number, v1: number, a2: number, v2: number) => {
    const da = Math.abs(get(content, a1, v1) - get(content, a2, v2))
    const dl = Math.abs(get(lum, a1, v1) - get(lum, a2, v2))
    return da + dl
  }

  const sv = Math.min(48, acrossLen)

  // 無相関ベースライン：約37%ずらした位置との平均差
  const shift = Math.max(1, Math.floor(alongLen * 0.37))
  const aStep = Math.max(1, Math.floor(alongLen / 32))
  let bsum = 0
  let bn = 0
  for (let j = 0; j < sv; j++) {
    const v = Math.floor((j + 0.5) * acrossLen / sv)
    for (let a = 0; a < alongLen; a += aStep) {
      bsum += diff(a, v, (a + shift) % alongLen, v)
      bn++
    }
  }
  const rawBase = bsum / Math.max(1, bn)
  if (rawBase < MIN_BASE) return 1 // ほぼ無地 → 周期は判定不能
  const base = Math.max(rawBase, 0.015)

  // 候補＝元寸法を割り切る数（無ければ全数にフォールバック）
  const cands: number[] = []
  for (let c = 2; c <= MAX_COUNT; c++) {
    if (origAlong % c !== 0) continue
    if (alongLen / c < MIN_FRAME_PX) continue
    cands.push(c)
  }
  if (cands.length === 0) {
    for (let c = 2; c <= MAX_COUNT && alongLen / c >= MIN_FRAME_PX; c++) cands.push(c)
  }
  if (cands.length === 0) return 1

  // 各候補を評価。採用条件＝隣接が無相関より十分似ている(period<ACCEPT) かつ
  // 境界が輪郭の谷に乗っている(sep>=MIN_SEP)。これで「細かく割ると似て見える」過剰分割を抑える。
  const scoreOf = new Map<number, number>()
  let best = -1
  let bestScore = Infinity

  for (const c of cands) {
    const frame = alongLen / c
    const su = Math.max(2, Math.min(16, Math.floor(frame)))
    const pair: number[] = []
    for (let k = 0; k < c - 1; k++) {
      let s = 0
      let m = 0
      for (let j = 0; j < sv; j++) {
        const v = Math.floor((j + 0.5) * acrossLen / sv)
        for (let u = 0; u < su; u++) {
          const off = (u + 0.5) * frame / su
          const a = Math.min(alongLen - 1, Math.floor(k * frame + off))
          const b = Math.min(alongLen - 1, Math.floor((k + 1) * frame + off))
          s += diff(a, v, b, v)
          m++
        }
      }
      pair.push(s / Math.max(1, m))
    }
    pair.sort((a, b) => a - b)
    const adj = pair[pair.length >> 1] // 中央値（外れフレームに頑健）
    const period = adj / base
    const sep = separatorEvidence(profile, c)
    if (period >= ACCEPT_PERIOD || sep < MIN_SEP) continue // 採用条件を満たさない

    const score = period - 0.85 * sep + OCCAM * Math.log2(c)
    scoreOf.set(c, score)
    if (score < bestScore) {
      bestScore = score
      best = c
    }
  }

  if (best < 0) return 1

  // 倍数の解決：best の約数で score がほぼ同点なら、最小の約数へ降りる（8→4）
  let chosen = best
  for (const c of cands) {
    if (c >= chosen) continue
    if (best % c !== 0) continue
    const sc = scoreOf.get(c)
    if (sc !== undefined && sc <= bestScore + TIE_MARGIN) {
      chosen = c
      break
    }
  }
  return chosen
}

function detectAxis(wk: WorkBuffer, axis: 'col' | 'row'): number {
  const { content, lum, w, h } = wk
  const alongLen = axis === 'col' ? w : h
  const acrossLen = axis === 'col' ? h : w
  const origAlong = axis === 'col' ? wk.nw : wk.nh
  const get: Get =
    axis === 'col' ? (buf, a, c) => buf[c * w + a] : (buf, a, c) => buf[a * w + c]

  // 存在量プロファイル（隙間検出用）
  const profile = new Float64Array(alongLen)
  for (let a = 0; a < alongLen; a++) {
    let s = 0
    for (let c = 0; c < acrossLen; c++) s += get(content, a, c)
    profile[a] = s / acrossLen
  }

  const gap = detectByGaps(profile)
  if (gap && gap >= 2) return gap

  return detectByPeriod(content, lum, profile, alongLen, acrossLen, origAlong, get)
}

/**
 * スプライトシート画像から推定される列数・行数を返す。
 * 検出できない・無地などの場合は { cols: 1, rows: 1 }。
 */
export async function detectSpriteGrid(imageUrl: string): Promise<DetectedGrid> {
  try {
    const img = await loadImage(imageUrl)
    const wk = buildWork(img)
    if (!wk) return { cols: 1, rows: 1 }
    const cols = detectAxis(wk, 'col')
    const rows = detectAxis(wk, 'row')
    return { cols, rows }
  } catch {
    return { cols: 1, rows: 1 }
  }
}
