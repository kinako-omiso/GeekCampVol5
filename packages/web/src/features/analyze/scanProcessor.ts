import { createFixedCamera } from '@gikcamp/reconstruction-wasm'
import { SCAN_DIRECTIONS, type ScanDirection, type SelectionStroke } from '@gikcamp/protocol'
import type { SilhouetteMask } from './reconstruction/types'
import type { MaskWorkerRequest, MaskWorkerResponse } from '../capture/pipeline/visualHullMaskWorkerTypes'
import type { VisualHullResponse } from './reconstruction/visualHullWorkerTypes'
import { createDefaultPlacement, prepareFighterModel, type BattleFighterModel } from '../battle/game/fighterPlacement'

type MaskResult = Extract<MaskWorkerResponse, { type: 'mask' }>

/** 本番でも検証画面と同じWorkerを利用する。MediaPipeは1 Workerで直列実行する。 */
export class ScanProcessor {
  private worker: Worker | null = null
  private reconstructionWorkers = new Map<Worker, () => void>()
  private nextId = 0
  private pending = new Map<number, { resolve: (value: MaskResult) => void; reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> }>()
  private disposed = false

  async register(blob: Blob): Promise<number> {
    const bitmap = await createImageBitmap(blob)
    if (this.disposed) { bitmap.close(); throw new Error('スキャンを終了しました。') }
    const id = ++this.nextId
    this.getWorker().postMessage({ type: 'register', frameId: id, bitmap } satisfies MaskWorkerRequest, [bitmap])
    return id
  }
  remove(frameId: number) { this.worker?.postMessage({ type: 'remove', frameId } satisfies MaskWorkerRequest) }
  segment(frameId: number, strokes: SelectionStroke[]): Promise<MaskResult> {
    return this.request({ type: 'segment', frameId, strokes, jobId: ++this.nextId })
  }
  auto(frameId: number, referenceFrameId: number, referenceMask: SilhouetteMask, selected: { x: number; y: number }): Promise<MaskResult> {
    return this.request({ type: 'auto', frameId, referenceFrameId, referenceMask, selected, jobId: ++this.nextId })
  }
  build(masks: Record<ScanDirection, SilhouetteMask>): Promise<BattleFighterModel> {
    if (this.disposed) return Promise.reject(new Error('スキャンを終了しました。'))
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./reconstruction/visualHull.worker.ts', import.meta.url), { type: 'module' })
      const finish = () => { clearTimeout(timer); worker.terminate(); this.reconstructionWorkers.delete(worker) }
      const timer = setTimeout(() => { finish(); reject(new Error('モデル生成がタイムアウトしました。撮り直してください。')) }, 120_000)
      this.reconstructionWorkers.set(worker, () => { finish(); reject(new Error('モデル生成を終了しました。')) })
      worker.onmessage = (event: MessageEvent<VisualHullResponse>) => {
        finish()
        const response = event.data
        if ('error' in response) { reject(new Error(response.error)); return }
        if (!response.geometry) { reject(new Error(response.geometryError ?? '形状解析を完了できませんでした。')); return }
        try {
          const model = { reconstruction: response.output.reconstruction, geometry: response.geometry,
            placement: createDefaultPlacement(response.output.reconstruction) }
          prepareFighterModel(model)
          resolve(model)
        } catch (cause) { reject(cause) }
      }
      worker.onerror = () => { finish(); reject(new Error('モデル生成Workerを起動できませんでした。')) }
      worker.postMessage({ id: ++this.nextId, options: { surface: 'binary', adaptiveBounds: true },
        views: SCAN_DIRECTIONS.map((direction, index) => ({ mask: masks[direction],
          camera: createFixedCamera(masks[direction].width, masks[direction].height, index * 90) })) })
    })
  }
  dispose() {
    this.disposed = true
    this.worker?.terminate()
    for (const cancel of this.reconstructionWorkers.values()) cancel()
    this.failPending('スキャンを終了しました。')
  }
  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../capture/pipeline/visualHullMask.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (event: MessageEvent<MaskWorkerResponse>) => {
        const job = this.pending.get(event.data.jobId)
        if (!job) return
        clearTimeout(job.timer); this.pending.delete(event.data.jobId)
        if (event.data.type === 'mask') job.resolve(event.data)
        else job.reject(new Error(event.data.type === 'error' ? event.data.error : 'Maskを取得できませんでした。'))
      }
      this.worker.onerror = () => {
        this.failPending('Mask生成Workerが停止しました。写真を送り直してください。')
        this.worker?.terminate(); this.worker = null
      }
    }
    return this.worker
  }
  private request(request: Extract<MaskWorkerRequest, { type: 'segment' | 'auto' }>): Promise<MaskResult> {
    if (this.disposed) return Promise.reject(new Error('スキャンを終了しました。'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.jobId)
        reject(new Error('Mask生成がタイムアウトしました。もう一度修正してください。'))
      }, 120_000)
      this.pending.set(request.jobId, { resolve, reject, timer })
      this.getWorker().postMessage(request)
    })
  }
  private failPending(message: string) {
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new Error(message)) }
    this.pending.clear()
  }
}
