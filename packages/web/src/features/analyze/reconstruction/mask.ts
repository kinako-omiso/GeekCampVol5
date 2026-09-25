import type { SilhouetteMask } from './types.ts'

export function prepareMask(mask: SilhouetteMask): SilhouetteMask {
  const { width, height, data } = mask
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height) {
    throw new Error('Maskのサイズが正しくありません。')
  }

  const size = width * height
  const labels = new Int32Array(size)
  const queue = new Int32Array(size)
  let label = 0
  let largestLabel = 0
  let largestSize = 0

  // 4近傍で成分を分け、孤立した手や影を取り除く。
  for (let start = 0; start < size; start += 1) {
    if (data[start] === 0 || labels[start] !== 0) continue
    label += 1
    labels[start] = label
    queue[0] = start
    let head = 0
    let tail = 1

    while (head < tail) {
      const index = queue[head++]
      const x = index % width
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        index >= width ? index - width : -1,
        index + width < size ? index + width : -1,
      ]
      for (const neighbor of neighbors) {
        if (neighbor < 0 || data[neighbor] === 0 || labels[neighbor] !== 0) continue
        labels[neighbor] = label
        queue[tail++] = neighbor
      }
    }

    if (tail > largestSize) {
      largestSize = tail
      largestLabel = label
    }
  }

  if (largestLabel === 0) throw new Error('対象物が見つかりません。選択点を変えてください。')

  const selected = new Uint8Array(size)
  for (let index = 0; index < size; index += 1) {
    selected[index] = labels[index] === largestLabel ? 1 : 0
  }

  // 画像の外側とつながる背景だけを残し、内側の穴は埋める。
  const outside = new Uint8Array(size)
  let head = 0
  let tail = 0
  const addBackground = (index: number) => {
    if (selected[index] !== 0 || outside[index] !== 0) return
    outside[index] = 1
    queue[tail++] = index
  }
  for (let x = 0; x < width; x += 1) {
    addBackground(x)
    addBackground((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    addBackground(y * width)
    addBackground(y * width + width - 1)
  }
  while (head < tail) {
    const index = queue[head++]
    const x = index % width
    if (x > 0) addBackground(index - 1)
    if (x + 1 < width) addBackground(index + 1)
    if (index >= width) addBackground(index - width)
    if (index + width < size) addBackground(index + width)
  }
  for (let index = 0; index < size; index += 1) {
    if (outside[index] === 0) selected[index] = 1
  }

  return { width, height, data: selected }
}
