export interface ImageProcessingOptions {
  removeBackground?: boolean
  backgroundTolerance?: number
}

export function detectBackgroundColor(imageData: ImageData, width: number, height: number): number[] {
  // Sample colors from the edges
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

export function removeBackgroundFromImage(
  imageData: ImageData, 
  width: number, 
  height: number,
  tolerance: number = 10
): ImageData {
  const bgColor = detectBackgroundColor(imageData, width, height)
  const result = new ImageData(width, height)
  const visited = new Set<number>()
  
  // Color similarity check
  const isColorSimilar = (idx: number): boolean => {
    const r = imageData.data[idx]
    const g = imageData.data[idx + 1]
    const b = imageData.data[idx + 2]
    
    return Math.abs(r - bgColor[0]) <= tolerance &&
           Math.abs(g - bgColor[1]) <= tolerance &&
           Math.abs(b - bgColor[2]) <= tolerance
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
  
  // Draw with nearest neighbor interpolation
  scaledCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight)
  
  return scaledCanvas
}

export function exportCanvasAsPNG(canvas: HTMLCanvasElement): string {
  // Export as PNG with maximum quality
  // PNG is lossless, so quality parameter doesn't affect it
  return canvas.toDataURL('image/png')
}