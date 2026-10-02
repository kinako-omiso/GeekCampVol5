export type OrientedMesh = { indices: Uint32Array; normals: Float32Array; correctedFaces: number; sealedFaces: number }

/** C++の面生成で生じる隣接面の逆向きをそろえ、形状解析へ閉じた面を渡す。 */
export function orientClosedMesh(positions: Float32Array, original: Uint32Array): OrientedMesh {
  const triangleCount = original.length / 3
  const vertexCount = positions.length / 3
  const canonical = new Uint32Array(vertexCount)
  const unique = new Map<string, number>()
  for (let i = 0; i < vertexCount; i += 1) {
    const key = `${Math.round(positions[i * 3] * 1e6)}:${Math.round(positions[i * 3 + 1] * 1e6)}:${Math.round(positions[i * 3 + 2] * 1e6)}`
    let id = unique.get(key)
    if (id === undefined) { id = unique.size; unique.set(key, id) }
    canonical[i] = id
  }
  const edges = new Map<number, { triangle: number; direction: number; count: number; a: number; b: number }>()
  const adjacent: Array<Array<{ triangle: number; reverse: boolean }>> = Array.from({ length: triangleCount }, () => [])
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = canonical[original[triangle * 3 + edge]]
      const b = canonical[original[triangle * 3 + (edge + 1) % 3]]
      if (a === b) throw new Error('退化した面を修正できませんでした。')
      const key = Math.min(a, b) * unique.size + Math.max(a, b)
      const direction = a < b ? 1 : -1
      const previous = edges.get(key)
      if (!previous) edges.set(key, { triangle, direction, count: 1, a, b })
      else {
        previous.count += 1
        if (previous.count > 2) throw new Error('3面以上が接する辺があります。')
        const reverse = previous.direction === direction
        adjacent[triangle].push({ triangle: previous.triangle, reverse })
        adjacent[previous.triangle].push({ triangle, reverse })
      }
    }
  }
  const flips = new Int8Array(triangleCount).fill(-1)
  for (let start = 0; start < triangleCount; start += 1) {
    if (flips[start] >= 0) continue
    flips[start] = 0
    const component: number[] = [], queue = [start]
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head]
      component.push(current)
      for (const neighbor of adjacent[current]) {
        const required = flips[current] ^ Number(neighbor.reverse)
        if (flips[neighbor.triangle] < 0) { flips[neighbor.triangle] = required; queue.push(neighbor.triangle) }
        else if (flips[neighbor.triangle] !== required) throw new Error('面の向きを一貫させられませんでした。')
      }
    }
    if (component.reduce((count, triangle) => count + flips[triangle], 0) > component.length / 2) {
      for (const triangle of component) flips[triangle] ^= 1
    }
  }
  const orientedIndices = new Uint32Array(original)
  let correctedFaces = 0
  for (let triangle = 0; triangle < triangleCount; triangle += 1) if (flips[triangle]) {
    const offset = triangle * 3, second = orientedIndices[offset + 1]
    orientedIndices[offset + 1] = orientedIndices[offset + 2]; orientedIndices[offset + 2] = second
    correctedFaces += 1
  }
  // 補間面で生じる短い境界ループだけを、逆向きの三角形でふさぐ。
  const boundary = new Map<number, { end: number; actualStart: number; actualEnd: number }>()
  const incoming = new Map<number, number>()
  for (const edge of edges.values()) {
    if (edge.count !== 1) continue
    const offset = edge.triangle * 3
    let actualStart = -1, actualEnd = -1
    for (let i = 0; i < 3; i += 1) {
      const a = orientedIndices[offset + i], b = orientedIndices[offset + (i + 1) % 3]
      if ((canonical[a] === edge.a && canonical[b] === edge.b) ||
        (canonical[a] === edge.b && canonical[b] === edge.a)) { actualStart = a; actualEnd = b; break }
    }
    if (actualStart < 0 || boundary.has(canonical[actualStart])) throw new Error('境界の分岐を修復できませんでした。')
    boundary.set(canonical[actualStart], { end: canonical[actualEnd], actualStart, actualEnd })
    incoming.set(canonical[actualEnd], (incoming.get(canonical[actualEnd]) ?? 0) + 1)
  }
  if ([...boundary.keys()].some((vertex) => incoming.get(vertex) !== 1)) throw new Error('境界の分岐を修復できませんでした。')
  const visited = new Set<number>(), caps: number[] = []
  for (const start of boundary.keys()) {
    if (visited.has(start)) continue
    const vertices: number[] = []
    let current = start
    while (!visited.has(current)) {
      visited.add(current)
      const edge = boundary.get(current)
      if (!edge) throw new Error('境界が閉じていません。')
      vertices.push(edge.actualStart)
      current = edge.end
    }
    if (current !== start || vertices.length < 3 || vertices.length > 32) throw new Error('大きな開口部を修復できませんでした。')
    for (let i = 1; i < vertices.length - 1; i += 1) caps.push(vertices[0], vertices[i + 1], vertices[i])
  }
  const indices = new Uint32Array(orientedIndices.length + caps.length)
  indices.set(orientedIndices); indices.set(caps, orientedIndices.length)
  const sealedFaces = caps.length / 3
  let volume = 0
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset] * 3, b = indices[offset + 1] * 3, c = indices[offset + 2] * 3
    volume += (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) +
      positions[a + 1] * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) / 6
  }
  if (volume < 0) for (let offset = 0; offset < indices.length; offset += 3) {
    const second = indices[offset + 1]
    indices[offset + 1] = indices[offset + 2]; indices[offset + 2] = second
  }
  const normals = new Float32Array(positions.length)
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset] * 3, b = indices[offset + 1] * 3, c = indices[offset + 2] * 3
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const vertex of [a, b, c]) { normals[vertex] += nx; normals[vertex + 1] += ny; normals[vertex + 2] += nz }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2])
    if (length > 1e-9) { normals[i] /= length; normals[i + 1] /= length; normals[i + 2] /= length }
  }
  return { indices, normals, correctedFaces, sealedFaces }
}
