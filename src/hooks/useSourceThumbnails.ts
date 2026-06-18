import { useEffect, useRef, useState } from 'react'
import type { SourceImage } from '../types'

export interface SourceThumbnail {
  // 軽量化したサムネイルのobjectURL（フレーム選択タイルの背景に使用）
  url: string
  // 元シートの実寸法（フレームの正しいアスペクト比計算に使用）
  naturalWidth: number
  naturalHeight: number
}

// プレビュー用サムネイルのシート長辺の最大ピクセル数。
// 高解像度シートをそのままタイル背景にすると60フレームで激重になるため、
// ニアレストネイバーで粗く縮小してドット絵感を出しつつ軽量化する。
const MAX_SHEET_EDGE = 640

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function createThumbnail(img: HTMLImageElement): Promise<SourceThumbnail | null> {
  const naturalWidth = img.naturalWidth
  const naturalHeight = img.naturalHeight
  if (naturalWidth === 0 || naturalHeight === 0) return Promise.resolve(null)

  // シート全体を一様にスケールするので、パーセント指定のフレーム切り出し（backgroundSize/Position）はそのまま成立する
  const scale = Math.min(1, MAX_SHEET_EDGE / Math.max(naturalWidth, naturalHeight))
  const w = Math.max(1, Math.round(naturalWidth * scale))
  const h = Math.max(1, Math.round(naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) return Promise.resolve(null)

  // ニアレストネイバーで縮小してドット絵のイメージを掴みやすくする
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0, w, h)

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null)
        return
      }
      resolve({ url: URL.createObjectURL(blob), naturalWidth, naturalHeight })
    }, 'image/png')
  })
}

/**
 * 各ソースシートから軽量なサムネイル（objectURL）と実寸法を生成する。
 * imageUrlが変わったソースだけ再生成し、不要になったobjectURLはrevokeする。
 */
export function useSourceThumbnails(sourceImages: SourceImage[]): Map<string, SourceThumbnail> {
  const [thumbnails, setThumbnails] = useState<Map<string, SourceThumbnail>>(new Map())
  const thumbnailsRef = useRef<Map<string, SourceThumbnail>>(new Map())

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      // 既存のサムネイルはimageUrlが同じ限り使い回す（cols/rows変更では再生成しない）
      const next = new Map<string, SourceThumbnail>()
      const current = thumbnailsRef.current

      for (const source of sourceImages) {
        const existing = current.get(source.id)
        if (existing && existing.url) {
          // imageUrlは変わらない前提（ソースのシート画像は固定）なので使い回す
          next.set(source.id, existing)
          continue
        }
        try {
          const img = await loadImage(source.imageUrl)
          if (cancelled) return
          const thumb = await createThumbnail(img)
          if (cancelled) {
            if (thumb) URL.revokeObjectURL(thumb.url)
            return
          }
          if (thumb) next.set(source.id, thumb)
        } catch {
          // 読み込み失敗時はサムネイルなし（タイルは枠だけ表示）
        }
      }

      if (cancelled) return

      // 削除されたソースのobjectURLを解放
      for (const [id, thumb] of current) {
        if (!next.has(id)) URL.revokeObjectURL(thumb.url)
      }

      thumbnailsRef.current = next
      setThumbnails(next)
    }

    run()

    return () => {
      cancelled = true
    }
  }, [sourceImages])

  // アンマウント時に全objectURLを解放
  useEffect(() => {
    return () => {
      for (const [, thumb] of thumbnailsRef.current) URL.revokeObjectURL(thumb.url)
      thumbnailsRef.current = new Map()
    }
  }, [])

  return thumbnails
}
