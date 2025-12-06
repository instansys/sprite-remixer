# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ビルド・開発コマンド

```bash
# 依存関係のインストール
bun install

# 開発サーバーの起動
bunx --bun vite

# 本番用ビルド
bun run build

# リンター実行
bun run lint

# 本番ビルドのプレビュー
bun run preview
```

## プロジェクト概要

Sprite Remixerは、高解像度のスプライトシートをドット絵風に変換し、フレームの選択と間引きができるWebアプリケーション。

## アーキテクチャ

### 主要コンポーネント

- **App.tsx** - メインアプリケーションコンポーネント：
  - 画像/動画/GIFファイルのアップロードと処理
  - フレームグリッドの生成と選択UI
  - スプライトシート処理のオーケストレーション
  - アニメーションプレビュー再生
  - localStorageによる設定の永続化

- **imageProcessing.ts** - 画像処理ユーティリティ：
  - `scaleImageNearestNeighbor()` - ドット絵向けのピクセルパーフェクトなスケーリング
  - `removeBackgroundFromImage()` - CIE76色差(ΔE)を使用したフラッドフィルによる背景除去
  - `detectBackgroundColor()` - 画像のエッジから背景色を自動検出
  - `erodeEdges()` - 背景除去をよりクリーンにするためのエッジ侵食
  - 知覚的な色比較のための色空間変換（RGB→Lab）

- **NumberInput.tsx** - バリデーションと最小/最大値制約を持つ制御された数値入力コンポーネント

### 処理フロー

1. **入力**: 画像、MP4動画、GIFファイルに対応
2. **動画/GIF処理**: フレームを抽出し、自動的にスプライトシートを作成
3. **フレーム選択**: ユーザーが含めるフレームを選択
4. **処理**: 最近傍補間でフレームをスケーリング、オプションで背景を除去
5. **出力**: ダウンロード可能なPNGスプライトシートを生成

### 技術的な注意点

- Canvas APIで`imageSmoothingEnabled = false`を使用してピクセルパーフェクトなレンダリングを実現
- GIF解析にはgifuct-jsライブラリを使用し、適切なdisposalメソッドを処理
- 設定は`sprite-remixer-*`プレフィックスのキーでlocalStorageに永続化
