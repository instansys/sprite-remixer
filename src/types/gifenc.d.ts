declare module 'gifenc' {
  interface GIFEncoderOptions {
    auto?: boolean
    initialCapacity?: number
  }

  interface WriteFrameOptions {
    palette: number[][]
    delay?: number
    repeat?: number
    transparent?: boolean
    transparentIndex?: number
    dispose?: number
  }

  interface GIFEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    buffer: ArrayBuffer
    stream: unknown
  }

  export function GIFEncoder(opts?: GIFEncoderOptions): GIFEncoderInstance

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: string; oneBitAlpha?: boolean | number }
  ): number[][]

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: string
  ): Uint8Array
}
