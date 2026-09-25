import type { SilhouetteMask } from './types.ts'

export type Point = { x: number; y: number }

function signedArea(points: Point[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    area += points[index].x * next.y - next.x * points[index].y
  }
  return area / 2
}

function simplifyOpen(points: Point[], toleranceSquared: number): Point[] {
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const ranges: Array<[number, number]> = [[0, points.length - 1]]

  while (ranges.length > 0) {
    const [first, last] = ranges.pop()!
    const a = points[first]
    const b = points[last]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    let farthest = -1
    let distanceSquared = toleranceSquared

    for (let index = first + 1; index < last; index += 1) {
      const point = points[index]
      const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
      const deltaX = point.x - (a.x + t * dx)
      const deltaY = point.y - (a.y + t * dy)
      const candidate = deltaX * deltaX + deltaY * deltaY
      if (candidate > distanceSquared) {
        distanceSquared = candidate
        farthest = index
      }
    }
    if (farthest < 0) continue
    keep[farthest] = 1
    ranges.push([first, farthest], [farthest, last])
  }

  return points.filter((_, index) => keep[index] === 1)
}

function simplifyClosed(points: Point[], tolerance: number): Point[] {
  const first = points[0]
  let opposite = 1
  let farthest = -1
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index].x - first.x
    const dy = points[index].y - first.y
    const distance = dx * dx + dy * dy
    if (distance > farthest) {
      farthest = distance
      opposite = index
    }
  }
  const forward = simplifyOpen(points.slice(0, opposite + 1), tolerance * tolerance)
  const backward = simplifyOpen([...points.slice(opposite), points[0]], tolerance * tolerance)
  return [...forward.slice(0, -1), ...backward.slice(0, -1)]
}

export function extractNormalizedContour(mask: SilhouetteMask): Point[] {
  const { width, height, data } = mask
  const stride = width + 1
  const vertexCount = stride * (height + 1)
  const outgoing = new Map<number, number[]>()
  const visited = new Set<number>()
  let edgeCount = 0

  const addEdge = (start: number, end: number) => {
    const ends = outgoing.get(start)
    if (ends) ends.push(end)
    else outgoing.set(start, [end])
    edgeCount += 1
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (data[index] === 0) continue
      const topLeft = y * stride + x
      const topRight = topLeft + 1
      const bottomLeft = topLeft + stride
      const bottomRight = bottomLeft + 1
      if (y === 0 || data[index - width] === 0) addEdge(topLeft, topRight)
      if (x + 1 === width || data[index + 1] === 0) addEdge(topRight, bottomRight)
      if (y + 1 === height || data[index + width] === 0) addEdge(bottomRight, bottomLeft)
      if (x === 0 || data[index - 1] === 0) addEdge(bottomLeft, topLeft)
    }
  }

  if (edgeCount === 0) throw new Error('輪郭を取得できませんでした。')
  const edgeId = (start: number, end: number) => start * vertexCount + end
  const pointOf = (id: number): Point => ({ x: id % stride, y: Math.floor(id / stride) })
  let outer: Point[] = []
  let largestArea = 0

  for (const [start, ends] of outgoing) {
    for (const firstEnd of ends) {
      if (visited.has(edgeId(start, firstEnd))) continue
      const loop: Point[] = []
      let previous = start
      let current = firstEnd
      visited.add(edgeId(previous, current))
      loop.push(pointOf(previous))

      while (current !== start) {
        loop.push(pointOf(current))
        const candidates = (outgoing.get(current) ?? []).filter((next) => !visited.has(edgeId(current, next)))
        if (candidates.length === 0 || loop.length > edgeCount) throw new Error('輪郭が閉じていません。別の対象を選択してください。')
        const incoming = { x: current % stride - previous % stride, y: Math.floor(current / stride) - Math.floor(previous / stride) }
        candidates.sort((a, b) => {
          const turnScore = (next: number) => {
            const direction = { x: next % stride - current % stride, y: Math.floor(next / stride) - Math.floor(current / stride) }
            const cross = incoming.x * direction.y - incoming.y * direction.x
            const dot = incoming.x * direction.x + incoming.y * direction.y
            return cross > 0 ? 3 : dot > 0 ? 2 : cross < 0 ? 1 : 0
          }
          return turnScore(b) - turnScore(a)
        })
        const next = candidates[0]
        visited.add(edgeId(current, next))
        previous = current
        current = next
      }

      const area = Math.abs(signedArea(loop))
      if (area > largestArea) {
        largestArea = area
        outer = loop
      }
    }
  }

  if (outer.length < 3 || largestArea < 1) throw new Error('有効な輪郭を取得できませんでした。')
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of outer) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  const longest = Math.max(maxX - minX, maxY - minY)
  const simplified = simplifyClosed(outer, longest * 0.002)
  if (simplified.length < 3) throw new Error('輪郭の頂点が足りません。')
  const normalized = simplified.map((point) => ({
    x: (point.x - (minX + maxX) / 2) / longest,
    y: (maxY - point.y) / longest,
  }))
  if (signedArea(normalized) < 0) normalized.reverse()
  return normalized
}
