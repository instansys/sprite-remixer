class TestImageData {
  constructor(dataOrWidth, widthOrHeight, height) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
      return
    }

    this.data = dataOrWidth
    this.width = widthOrHeight
    this.height = height
  }
}

globalThis.ImageData = TestImageData

const {
  getCornerColor,
  removeBackgroundFromImage
} = await import('../src/imageProcessing.ts')

const wasmExports = await loadWasm()

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function loadWasm() {
  const wasmBytes = await Bun.file(new URL('../src/wasm/background_removal.wasm', import.meta.url)).arrayBuffer()
  const { instance } = await WebAssembly.instantiate(wasmBytes, {})
  return instance.exports
}

function sourceToWasm(source) {
  switch (source) {
    case 'top-left':
      return 1
    case 'top-right':
      return 2
    case 'bottom-left':
      return 3
    case 'bottom-right':
      return 4
    default:
      return 0
  }
}

function removeBackgroundWithWasm(
  image,
  tolerance = 10,
  erosion = 0,
  colorSource = 'auto',
  fillInterior = false
) {
  const byteLength = image.width * image.height * 4
  const inputPtr = wasmExports.alloc(byteLength)
  const outputPtr = wasmExports.alloc(byteLength)

  try {
    new Uint8Array(wasmExports.memory.buffer).set(image.data, inputPtr)
    const status = wasmExports.remove_background(
      inputPtr,
      outputPtr,
      image.width,
      image.height,
      tolerance,
      erosion,
      sourceToWasm(colorSource),
      fillInterior ? 1 : 0
    )
    assert(status === 0, `wasm remove_background failed with status ${status}`)

    const output = new Uint8ClampedArray(
      new Uint8Array(wasmExports.memory.buffer).slice(outputPtr, outputPtr + byteLength)
    )
    return new ImageData(output, image.width, image.height)
  } finally {
    wasmExports.dealloc(inputPtr, byteLength)
    wasmExports.dealloc(outputPtr, byteLength)
  }
}

function assertSameImageData(actual, expected, label) {
  assert(actual.width === expected.width && actual.height === expected.height, `${label}: size mismatch`)
  for (let i = 0; i < actual.data.length; i++) {
    if (actual.data[i] !== expected.data[i]) {
      throw new Error(`${label}: byte ${i} mismatch, wasm=${actual.data[i]} js=${expected.data[i]}`)
    }
  }
}

function processBoth(image, tolerance = 10, erosion = 0, colorSource = 'auto', fillInterior = false, label = 'case') {
  const jsOutput = removeBackgroundFromImage(
    image,
    image.width,
    image.height,
    tolerance,
    erosion,
    colorSource,
    fillInterior
  )
  const wasmOutput = removeBackgroundWithWasm(image, tolerance, erosion, colorSource, fillInterior)
  assertSameImageData(wasmOutput, jsOutput, label)
  return jsOutput
}

function createImage(width, height, color = [0, 255, 0, 255]) {
  const image = new ImageData(width, height)
  for (let pixel = 0; pixel < width * height; pixel++) {
    const idx = pixel * 4
    image.data[idx] = color[0]
    image.data[idx + 1] = color[1]
    image.data[idx + 2] = color[2]
    image.data[idx + 3] = color[3]
  }
  return image
}

function setPixel(image, x, y, color) {
  const idx = (y * image.width + x) * 4
  image.data[idx] = color[0]
  image.data[idx + 1] = color[1]
  image.data[idx + 2] = color[2]
  image.data[idx + 3] = color[3] ?? 255
}

function getPixel(image, x, y) {
  const idx = (y * image.width + x) * 4
  return [
    image.data[idx],
    image.data[idx + 1],
    image.data[idx + 2],
    image.data[idx + 3]
  ]
}

function assertPixelEquals(image, x, y, expected, label) {
  const actual = getPixel(image, x, y)
  assert(
    actual[0] === expected[0] &&
      actual[1] === expected[1] &&
      actual[2] === expected[2] &&
      actual[3] === expected[3],
    `${label}: expected ${expected}, got ${actual}`
  )
}

function composite(foreground, background, alpha) {
  return [
    Math.round(alpha * foreground[0] + (1 - alpha) * background[0]),
    Math.round(alpha * foreground[1] + (1 - alpha) * background[1]),
    Math.round(alpha * foreground[2] + (1 - alpha) * background[2]),
    255
  ]
}

const green = [0, 255, 0]
const red = [255, 0, 0]
const gray = [150, 150, 150]

{
  const image = createImage(7, 5)
  setPixel(image, 2, 2, composite(red, green, 0.25))
  setPixel(image, 3, 2, [255, 0, 0, 255])
  setPixel(image, 4, 2, composite(red, green, 0.5))

  const output = processBoth(image, 10, 0, 'auto', false, 'semi-transparent greenback matte')
  const background = getPixel(output, 0, 0)
  const quarter = getPixel(output, 2, 2)
  const half = getPixel(output, 4, 2)
  const solid = getPixel(output, 3, 2)

  assert(background[3] === 0, `expected background alpha 0, got ${background}`)
  assert(quarter[3] >= 55 && quarter[3] <= 75, `expected 25% alpha recovery, got ${quarter}`)
  assert(quarter[0] >= 240 && quarter[1] <= 30 && quarter[2] <= 30, `expected green spill removed at 25%, got ${quarter}`)
  assert(half[3] >= 118 && half[3] <= 138, `expected 50% alpha recovery, got ${half}`)
  assert(half[0] >= 240 && half[1] <= 30 && half[2] <= 30, `expected green spill removed at 50%, got ${half}`)
  assert(solid[3] === 255 && solid[0] === 255 && solid[1] === 0 && solid[2] === 0, `expected solid red preserved, got ${solid}`)

  console.log('semi-transparent greenback matte:', { background, quarter, half, solid })
}

{
  const image = createImage(9, 7)
  for (let y = 2; y <= 4; y++) {
    for (let x = 3; x <= 5; x++) {
      setPixel(image, x, y, [150, 150, 150, 255])
    }
  }
  setPixel(image, 2, 3, composite(gray, green, 0.5))

  const output = processBoth(image, 10, 0, 'auto', false, 'low-contrast contour matte recovery')
  const background = getPixel(output, 0, 0)
  const half = getPixel(output, 2, 3)
  const solid = getPixel(output, 4, 3)

  assert(background[3] === 0, `expected low-contrast background alpha 0, got ${background}`)
  assert(half[3] >= 118 && half[3] <= 138, `expected low-contrast 50% matte recovery, got ${half}`)
  assert(half[0] >= 140 && half[0] <= 160 && half[1] >= 140 && half[1] <= 160 && half[2] >= 140 && half[2] <= 160, `expected low-contrast spill removed, got ${half}`)
  assert(solid[3] === 255 && solid[0] === 150 && solid[1] === 150 && solid[2] === 150, `expected low-contrast solid preserved, got ${solid}`)

  console.log('low-contrast contour matte recovery:', { background, half, solid })
}

{
  const image = createImage(9, 7, [0, 0, 0, 0])
  for (let y = 1; y <= 5; y++) {
    for (let x = 2; x <= 6; x++) {
      setPixel(image, x, y, [0, 255, 0, 255])
    }
  }
  setPixel(image, 3, 3, composite(red, green, 0.5))
  setPixel(image, 4, 3, [255, 0, 0, 255])

  const output = processBoth(image, 10, 0, 'auto', false, 'transparent padding background detection')
  const transparentPadding = getPixel(output, 0, 0)
  const innerBackground = getPixel(output, 2, 3)
  const half = getPixel(output, 3, 3)
  const solid = getPixel(output, 4, 3)

  assert(transparentPadding[3] === 0, `expected transparent padding to stay transparent, got ${transparentPadding}`)
  assert(innerBackground[3] === 0, `expected inner green background removed despite transparent padding, got ${innerBackground}`)
  assert(half[3] >= 118 && half[3] <= 138 && half[0] >= 240 && half[1] <= 30, `expected padded 50% matte recovery, got ${half}`)
  assert(solid[3] === 255 && solid[0] === 255 && solid[1] === 0 && solid[2] === 0, `expected padded solid red preserved, got ${solid}`)

  console.log('transparent padding background detection:', { transparentPadding, innerBackground, half, solid })
}

{
  const image = createImage(12, 7)
  for (let y = 1; y <= 5; y++) {
    setPixel(image, 3, y, composite(red, green, 0.5))
    setPixel(image, 4, y, composite(red, green, 0.5))
    setPixel(image, 5, y, [255, 0, 0, 255])
    setPixel(image, 6, y, [255, 0, 0, 255])
    setPixel(image, 7, y, composite(red, green, 0.25))
    setPixel(image, 8, y, composite(red, green, 0.25))
    setPixel(image, 9, y, composite(red, green, 0.25))
  }

  const output = processBoth(image, 10, 0, 'auto', false, 'continuous semi-transparent band recovery')
  const leftBand = getPixel(output, 3, 3)
  const rightBand = getPixel(output, 9, 3)

  assert(leftBand[3] >= 118 && leftBand[3] <= 138 && leftBand[0] >= 240 && leftBand[1] <= 30, `expected 50% matte band recovery, got ${leftBand}`)
  assert(rightBand[3] >= 55 && rightBand[3] <= 75 && rightBand[0] >= 240 && rightBand[1] <= 30, `expected 25% matte band recovery, got ${rightBand}`)

  console.log('continuous semi-transparent band recovery:', { leftBand, rightBand })
}

{
  const image = createImage(7, 7)
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) {
      setPixel(image, x, y, [150, 150, 150, 255])
    }
  }

  const output = processBoth(image, 10, 0, 'auto', false, 'hard foreground edge preservation')
  const background = getPixel(output, 0, 0)
  const hardEdge = getPixel(output, 2, 2)
  const center = getPixel(output, 3, 3)

  assert(background[3] === 0, `expected hard-edge background alpha 0, got ${background}`)
  assert(hardEdge[3] === 255 && hardEdge[0] === 150 && hardEdge[1] === 150 && hardEdge[2] === 150, `expected hard gray edge preserved, got ${hardEdge}`)
  assert(center[3] === 255 && center[0] === 150 && center[1] === 150 && center[2] === 150, `expected hard gray center preserved, got ${center}`)

  console.log('hard foreground edge preservation:', { background, hardEdge, center })
}

{
  const image = createImage(9, 7)
  const foreground = new Map()
  const colors = [
    [80, 72, 160, 255],
    [95, 84, 168, 255],
    [110, 82, 150, 255],
    [130, 77, 140, 255],
    [145, 87, 155, 255],
    [95, 92, 168, 255],
    [110, 90, 150, 255],
    [130, 85, 140, 255],
    [145, 95, 155, 255],
    [80, 88, 160, 255],
    [95, 100, 168, 255],
    [110, 98, 150, 255],
    [130, 93, 140, 255],
    [145, 103, 155, 255]
  ]
  let colorIndex = 0

  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 6; x++) {
      if (x === 2 && y === 3) continue
      const color = colors[colorIndex++]
      setPixel(image, x, y, color)
      foreground.set(`${x},${y}`, color)
    }
  }

  const output = processBoth(image, 10, 0, 'auto', false, 'opaque varied foreground preservation')

  for (const [key, color] of foreground) {
    const [x, y] = key.split(',').map(Number)
    assertPixelEquals(output, x, y, color, `opaque varied foreground at ${key}`)
  }

  console.log('opaque varied foreground preservation:', {
    edge: getPixel(output, 2, 2),
    center: getPixel(output, 4, 3)
  })
}

{
  const image = createImage(9, 7)
  for (let y = 2; y <= 4; y++) {
    setPixel(image, 4, y, [0, 255, 0, 255])
  }

  const output = processBoth(image, 10, 1, 'auto', true, 'fill interior and erosion')
  const interior = getPixel(output, 4, 3)
  assert(interior[3] === 0, `expected interior green removed, got ${interior}`)

  console.log('fill interior and erosion:', { interior })
}

{
  const image = createImage(20, 20)
  setPixel(image, 0, 0, [20, 230, 5, 255])
  const corner = getCornerColor(image, image.width, image.height, 'top-left')
  assert(corner[0] === 0 && corner[1] === 255 && corner[2] === 0, `expected robust corner median, got ${corner}`)

  console.log('corner background median:', { corner })
}

{
  const image = createImage(12, 8, [254, 255, 254, 255])
  for (let y = 2; y <= 5; y++) {
    for (let x = 2; x <= 9; x++) {
      setPixel(image, x, y, [255, 255, 255, 255])
    }
  }
  setPixel(image, 5, 3, [110, 70, 40, 255])
  setPixel(image, 6, 3, [130, 90, 55, 255])
  setPixel(image, 5, 4, [120, 80, 45, 255])
  setPixel(image, 6, 4, [140, 95, 60, 255])

  const output = processBoth(image, 10, 0, 'auto', false, 'near-white saturated background noise')
  const edgeBackground = getPixel(output, 0, 0)
  const whiteNoise = getPixel(output, 3, 3)
  const foreground = getPixel(output, 5, 3)

  assert(edgeBackground[3] === 0, `expected detected off-white background removed, got ${edgeBackground}`)
  assert(whiteNoise[3] === 0, `expected pure-white background noise removed, got ${whiteNoise}`)
  assertPixelEquals(output, 5, 3, [110, 70, 40, 255], 'near-white noise foreground')

  console.log('near-white saturated background noise:', { edgeBackground, whiteNoise, foreground })
}
