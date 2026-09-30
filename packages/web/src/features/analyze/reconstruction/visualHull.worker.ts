import { analyzeGeometry } from '@gikcamp/geometry-wasm'
import { reconstructVisualHull } from '@gikcamp/reconstruction-wasm'
import type { VisualHullRequest, VisualHullResponse } from './visualHullWorkerTypes'

const scope = self as unknown as Worker
scope.onmessage = (event: MessageEvent<VisualHullRequest>) => {
  const { id, views } = event.data
  void (async () => {
    try {
      const output = await reconstructVisualHull(views)
      let geometry = null
      let geometryError: string | undefined
      try { geometry = await analyzeGeometry({ ...output.reconstruction, source: 'reconstruction' }) }
      catch (cause) { geometryError = cause instanceof Error ? cause.message : '形状解析に失敗しました。' }
      const response: VisualHullResponse = { id, output, geometry, geometryError }
      const transfers: Transferable[] = [output.reconstruction.positions.buffer, output.reconstruction.indices.buffer,
        output.reconstruction.normals.buffer, output.occupancy.buffer]
      if (geometry) transfers.push(geometry.hullPositions.buffer, geometry.hullIndices.buffer)
      scope.postMessage(response, transfers)
    } catch (cause) {
      const response: VisualHullResponse = { id, error: cause instanceof Error ? cause.message : '再構成に失敗しました。' }
      scope.postMessage(response)
    }
  })()
}
