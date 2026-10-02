import { SCAN_DIRECTIONS, assignScanDirections, type AssetManifest, type ControlMessage, type PlayerSlot,
  type ScanDirection, type SelectionStroke } from '@gikcamp/protocol'
import type { ScanProcessor } from '../../features/analyze/scanProcessor'
import type { SilhouetteMask } from '../../features/analyze/reconstruction/types'
import type { BattleFighterModel } from '../../features/battle/game/fighterPlacement'
import type { BattleResult, BattleSnapshot } from '../../features/battle/game/battleRules'
import type { ScanneeLook } from '../../components/scanneeLook'
import type { ScanStatus } from '../../features/analyze/ScanProgressScreen'

type FlowState = Extract<ControlMessage, { type: 'flow-state' }>
type MaskReady = Extract<ControlMessage, { type: 'mask-ready' }>
type Frame = { photoId: string; blob?: Blob; frameId?: number; mask?: SilhouetteMask;
  width?: number; height?: number;
  strokes: SelectionStroke[]; revision: number; deliveredRevision: number; metadata?: MaskReady }
type Scan = { id: string; frames: Record<ScanDirection, Frame>; phase: 'receiving' | 'processing' | 'review' | 'building' | 'done'; busy: boolean }
export type HostPlayer = { connected: boolean; sensorReady: boolean; ready: boolean; status: ScanStatus;
  message: string; progress: number; look?: ScanneeLook; model?: BattleFighterModel }
export type HostMatchSnapshot = { step: 'lobby' | 'scan' | 'battle' | 'result'; roundId: string;
  players: Record<PlayerSlot, HostPlayer>; paused: boolean; resumeSeconds: number; result: BattleResult | null }
type Transport = { sendControl: (slot: PlayerSlot, message: ControlMessage) => void;
  sendAsset: (slot: PlayerSlot, blob: Blob, details: Pick<AssetManifest, 'kind' | 'width' | 'height' | 'scan' | 'transferId'>) => Promise<AssetManifest> }
type Processor = Pick<ScanProcessor, 'register' | 'remove' | 'segment' | 'auto' | 'build' | 'dispose'>
type Images = { maskToBlob: (mask: SilhouetteMask) => Promise<Blob>; createScanLook: (photo: Blob, mask: SilhouetteMask) => Promise<ScanneeLook> }
type Battle = { setPaused: (paused: boolean) => void; setInput: (player: 'p1' | 'p2', input: { x: number; y: number }) => void;
  triggerAttack: (player: 'p1' | 'p2', button: 'a' | 'b') => boolean }
const playerId = (slot: PlayerSlot) => slot === 1 ? 'p1' : 'p2'
const newPlayer = (): HostPlayer => ({ connected: false, sensorReady: false, ready: false, status: 'capturing', message: '', progress: 0 })

/** PCを進行の管理元とし、通信・Worker・対戦の完了を画面状態へ反映する。 */
export class HostMatch {
  private state: HostMatchSnapshot = { step: 'lobby', roundId: crypto.randomUUID(),
    players: { 1: newPlayer(), 2: newPlayer() }, paused: true, resumeSeconds: 0, result: null }
  private scans: Partial<Record<PlayerSlot, Scan>> = {}
  private transport: Transport
  private processor: Processor
  private images: Images
  private onChange: (snapshot: HostMatchSnapshot) => void
  private battle: Battle | null = null
  private queue: Promise<void> = Promise.resolve()
  private resumeTimer?: ReturnType<typeof setTimeout>
  private disposed = false

  constructor(transport: Transport, processor: Processor, images: Images, onChange: (snapshot: HostMatchSnapshot) => void) {
    this.transport = transport; this.processor = processor; this.images = images; this.onChange = onChange
  }
  snapshot(): HostMatchSnapshot {
    return { ...this.state, players: { 1: { ...this.state.players[1] }, 2: { ...this.state.players[2] } } }
  }
  connected(slot: PlayerSlot) {
    this.state.players[slot].connected = true
    this.publish()
    // 確認中のMaskは、切断でスマホが失った場合にも同じ版を再送する。
    const scan = this.scans[slot]
    if (scan?.phase === 'review') this.enqueue(slot, scan, async () => {
      for (const direction of SCAN_DIRECTIONS) if (scan.frames[direction].mask) await this.deliverMask(slot, scan, direction)
    })
  }
  disconnected(slot: PlayerSlot) {
    const player = this.state.players[slot]
    player.connected = false; player.ready = false; player.sensorReady = false
    this.pause()
    this.publish()
  }
  motion(slot: PlayerSlot, input: { x: number; y: number }) {
    if (this.state.step === 'battle' && !this.state.paused) this.battle?.setInput(playerId(slot), input)
  }
  attack(slot: PlayerSlot, button: 'a' | 'b') {
    if (this.state.step === 'battle' && !this.state.paused) this.battle?.triggerAttack(playerId(slot), button)
  }
  progress(slot: PlayerSlot, received: number, total: number) {
    const player = this.state.players[slot]
    if (this.scans[slot]?.phase !== 'receiving') return
    const completed = SCAN_DIRECTIONS.filter((direction) => this.scans[slot]!.frames[direction].blob).length
    player.status = 'sending'; player.progress = Math.min(1, (completed + received / total) / 4)
    this.publish(false)
  }
  control(slot: PlayerSlot, message: ControlMessage) {
    const player = this.state.players[slot]
    if (message.type === 'sensor-enabled') { player.sensorReady = true; this.publish(); return }
    if (message.type === 'sensor-reset') { player.sensorReady = false; player.ready = false; this.pause(); this.publish(); return }
    if (message.type === 'sensor-ready') {
      player.sensorReady = true; player.ready = true
      if (this.state.step === 'lobby' && this.allReady()) this.state.step = 'scan'
      this.tryStartBattle(); this.tryResume(); this.publish(); return
    }
    if (this.state.step !== 'scan' || !player.ready) return
    if (message.type === 'scan-start') {
      const previous = this.scans[slot]
      if (previous?.id === message.scanId) return
      if (previous?.phase === 'building' || previous?.phase === 'done') return
      this.clearScan(slot)
      const assignments = assignScanDirections(message.photoIds, message.frontPhotoId)
      const frames = Object.fromEntries(SCAN_DIRECTIONS.map((direction) => [direction,
        { photoId: assignments[direction], strokes: direction === 'front' ? message.strokes : [], revision: 0, deliveredRevision: -1 }])) as Record<ScanDirection, Frame>
      this.scans[slot] = { id: message.scanId, frames, phase: 'receiving', busy: false }
      player.status = 'sending'; player.message = ''; delete player.model; delete player.look
      this.publish(); return
    }
    const scan = this.scans[slot]
    if (!scan || !('scanId' in message) || message.scanId !== scan.id) return
    if (message.type === 'scan-retry' && scan.phase !== 'building' && scan.phase !== 'done') {
      this.clearScan(slot); player.status = 'capturing'; player.message = ''; this.publish(); return
    }
    if (message.type === 'scan-revise' && scan.phase === 'review' && !scan.busy) {
      const frame = scan.frames[message.direction]
      if (message.revision !== frame.revision + 1 || !frame.frameId) return
      const previousStrokes = frame.strokes
      frame.revision = message.revision; frame.strokes = message.strokes
      this.enqueue(slot, scan, async () => {
        let result: Awaited<ReturnType<Processor['segment']>>
        try { result = await this.processor.segment(frame.frameId!, frame.strokes) }
        catch (cause) {
          if (this.current(slot, scan)) {
            frame.revision -= 1; frame.strokes = previousStrokes
            this.transport.sendControl(slot, { type: 'scan-revision-failed', scanId: scan.id,
              direction: message.direction, revision: message.revision, reason: errorMessage(cause) })
          }
          throw cause
        }
        if (!this.current(slot, scan)) return
        frame.mask = result.mask
        frame.metadata = this.maskMetadata(scan, message.direction, result.quality.needsReview, result.quality.reason)
        await this.deliverMask(slot, scan, message.direction)
        if (message.direction === 'front' && result.mask.data.some(Boolean)) await this.generateMissingMasks(slot, scan)
      }); return
    }
    if (message.type === 'scan-resend-masks' && scan.phase === 'review' && !scan.busy) {
      player.message = ''
      this.enqueue(slot, scan, async () => {
        for (const direction of SCAN_DIRECTIONS) if (scan.frames[direction].mask) await this.deliverMask(slot, scan, direction)
        await this.generateMissingMasks(slot, scan)
      }); return
    }
    if (message.type === 'scan-confirm' && scan.phase === 'review' && !scan.busy && SCAN_DIRECTIONS.every((direction, index) => {
      const frame = scan.frames[direction]
      return frame.mask?.data.some(Boolean) && frame.deliveredRevision === frame.revision && message.revisions[index] === frame.revision
    })) {
      scan.phase = 'building'; player.status = 'waiting'; this.publish()
      this.enqueue(slot, scan, async () => {
        const masks = Object.fromEntries(SCAN_DIRECTIONS.map((direction) => [direction, scan.frames[direction].mask!])) as Record<ScanDirection, SilhouetteMask>
        const model = await this.processor.build(masks)
        if (!this.current(slot, scan)) return
        const look = await this.images.createScanLook(scan.frames.front.blob!, masks.front)
        if (!this.current(slot, scan)) return
        player.model = model; player.look = look; player.status = 'done'; player.message = ''
        scan.phase = 'done'; scan.busy = false
        this.tryStartBattle()
      }, true)
    }
  }
  async asset(slot: PlayerSlot, manifest: AssetManifest, blob: Blob) {
    const scan = this.scans[slot]
    if (manifest.kind !== 'photo' || !scan || !manifest.scan || manifest.scan.scanId !== scan.id || scan.phase !== 'receiving') return
    const frame = scan.frames[manifest.scan.direction]
      if (frame.photoId !== manifest.scan.photoId || frame.blob) return
    frame.blob = blob; frame.width = manifest.width; frame.height = manifest.height
    try {
      const frameId = await this.processor.register(blob)
      if (!this.current(slot, scan)) { this.processor.remove(frameId); return }
      frame.frameId = frameId
      if (!SCAN_DIRECTIONS.every((direction) => scan.frames[direction].frameId)) return
      scan.phase = 'processing'
      this.enqueue(slot, scan, async () => {
        const front = scan.frames.front
        const result = await this.processor.segment(front.frameId!, front.strokes)
        if (!this.current(slot, scan)) return
        front.mask = result.mask
        front.metadata = this.maskMetadata(scan, 'front', result.quality.needsReview, result.quality.reason)
        await this.deliverMask(slot, scan, 'front')
        if (!front.mask.data.some(Boolean)) { scan.phase = 'review'; return }
        await this.generateMissingMasks(slot, scan)
        scan.phase = 'review'
      })
    } catch (cause) { this.failScan(slot, scan, cause) }
  }
  attachBattle(battle: Battle | null) { this.battle = battle; if (battle) { battle.setPaused(true); this.tryResume() } }
  battleSnapshot(snapshot: BattleSnapshot) {
    if (this.state.step !== 'battle' || !snapshot.result) return
    this.state.result = snapshot.result; this.state.step = 'result'; this.pause()
    if (snapshot.result.winner !== 'draw') this.transport.sendControl(snapshot.result.winner === 'p1' ? 2 : 1, { type: 'feedback', effect: 'defeat' })
    this.publish()
  }
  feedback(slot: PlayerSlot, effect: 'hit' | 'damage') { this.transport.sendControl(slot, { type: 'feedback', effect }) }
  restart() {
    this.pause(); this.battle = null
    for (const slot of [1, 2] as const) {
      this.clearScan(slot)
      this.state.players[slot] = { ...newPlayer(), connected: this.state.players[slot].connected }
    }
    this.state.roundId = crypto.randomUUID(); this.state.step = 'lobby'; this.state.result = null
    this.publish()
  }
  dispose() { this.disposed = true; clearTimeout(this.resumeTimer); this.processor.dispose() }
  private allReady() { return this.state.players[1].connected && this.state.players[1].ready && this.state.players[2].connected && this.state.players[2].ready }
  private current(slot: PlayerSlot, scan: Scan) { return !this.disposed && this.scans[slot] === scan }
  private clearScan(slot: PlayerSlot) {
    const scan = this.scans[slot]
    if (scan) for (const frame of Object.values(scan.frames)) if (frame.frameId) this.processor.remove(frame.frameId)
    delete this.scans[slot]
  }
  private enqueue(slot: PlayerSlot, scan: Scan, work: () => Promise<void>, recaptureOnError = false) {
    scan.busy = true; this.state.players[slot].status = 'waiting'; this.state.players[slot].message = ''; this.publish()
    this.queue = this.queue.then(async () => {
      if (!this.current(slot, scan)) return
      this.state.players[slot].status = 'analyzing'; this.publish()
      try { await work() }
      catch (cause) {
        if (!this.current(slot, scan)) return
        if (recaptureOnError) this.failScan(slot, scan, cause)
        else { scan.phase = 'review'; this.state.players[slot].message = errorMessage(cause) }
      }
      if (!this.current(slot, scan)) return
      scan.busy = false
      this.state.players[slot].status = scan.phase === 'done' ? 'done' : 'review'
      this.publish()
    }).catch(() => {})
  }
  private failScan(slot: PlayerSlot, scan: Scan, cause: unknown) {
    if (!this.current(slot, scan)) return
    this.clearScan(slot)
    const player = this.state.players[slot]
    player.status = 'capturing'; player.message = errorMessage(cause)
    delete player.model; delete player.look
    this.publish()
  }
  private maskMetadata(scan: Scan, direction: ScanDirection, needsReview: boolean, reason: string): MaskReady {
    const frame = scan.frames[direction]
    return { type: 'mask-ready', scanId: scan.id, direction, revision: frame.revision,
      transferId: crypto.randomUUID(), strokes: frame.strokes.length ? frame.strokes : [{ mode: 'add', points: [{ x: 0.5, y: 0.5 }] }],
      needsReview, empty: !frame.mask?.data.some(Boolean), reason }
  }
  private async generateMissingMasks(slot: PlayerSlot, scan: Scan) {
    const front = scan.frames.front
    if (!front.mask?.data.some(Boolean)) return
    const selected = front.strokes.filter((stroke) => stroke.mode === 'add').at(-1)?.points.at(-1) ?? { x: 0.5, y: 0.5 }
    for (const direction of SCAN_DIRECTIONS.slice(1)) {
      if (!this.current(slot, scan)) return
      const target = scan.frames[direction]
      if (target.mask) continue
      try {
        const generated = await this.processor.auto(target.frameId!, front.frameId!, front.mask, selected)
        if (!this.current(slot, scan)) return
        target.mask = generated.mask; target.strokes = [{ mode: 'add', points: [generated.seed ?? selected] }]
        target.metadata = this.maskMetadata(scan, direction, generated.quality.needsReview, generated.quality.reason)
      } catch (cause) {
        const scale = Math.min(1, 1024 / Math.max(target.width!, target.height!))
        const width = Math.max(1, Math.round(target.width! * scale)), height = Math.max(1, Math.round(target.height! * scale))
        target.mask = { width, height, data: new Uint8Array(width * height) }
        target.strokes = [{ mode: 'add', points: [selected] }]
        target.metadata = this.maskMetadata(scan, direction, true, errorMessage(cause))
      }
      await this.deliverMask(slot, scan, direction)
    }
  }
  private async deliverMask(slot: PlayerSlot, scan: Scan, direction: ScanDirection) {
    const frame = scan.frames[direction]
    if (!frame.mask || !frame.metadata || !this.current(slot, scan)) return
    const metadata = frame.metadata
    const blob = await this.images.maskToBlob(frame.mask)
    if (!this.current(slot, scan)) return
    this.transport.sendControl(slot, metadata)
    await this.transport.sendAsset(slot, blob, { kind: 'mask', transferId: metadata.transferId,
      width: frame.mask.width, height: frame.mask.height,
      scan: { scanId: scan.id, photoId: frame.photoId, direction, revision: frame.revision } })
    if (this.current(slot, scan)) frame.deliveredRevision = frame.revision
  }
  private tryStartBattle() {
    if (this.state.step === 'scan' && this.allReady() && this.state.players[1].model && this.state.players[2].model) {
      this.state.step = 'battle'; this.state.paused = true
    }
  }
  private pause() {
    clearTimeout(this.resumeTimer); this.resumeTimer = undefined
    this.state.paused = true; this.state.resumeSeconds = 0
    this.battle?.setPaused(true)
  }
  private tryResume() {
    if (this.state.step !== 'battle' || !this.allReady() || !this.battle || !this.state.paused || this.resumeTimer) return
    this.state.resumeSeconds = 3
    this.publish()
    const tick = () => {
      if (!this.allReady() || this.state.step !== 'battle') { this.pause(); this.publish(); return }
      this.state.resumeSeconds -= 1
      if (this.state.resumeSeconds === 0) {
        this.resumeTimer = undefined; this.state.paused = false; this.battle?.setPaused(false)
      } else this.resumeTimer = setTimeout(tick, 1000)
      this.publish()
    }
    this.resumeTimer = setTimeout(tick, 1000)
  }
  private flow(slot: PlayerSlot): FlowState {
    const player = this.state.players[slot], scan = this.scans[slot]
    let phase: FlowState['phase'] = 'join'
    if (player.ready) {
      if (this.state.step === 'battle') phase = 'battle'
      else if (this.state.step === 'result') phase = 'result'
      else if (this.state.step === 'scan') phase = !scan ? 'capture' : scan.phase === 'receiving' ? 'capture' :
        scan.busy ? 'processing' : scan.phase === 'review' ? 'review' : 'waiting'
    }
    const message: FlowState = { type: 'flow-state', roundId: this.state.roundId, phase,
      paused: this.state.paused, resumeSeconds: this.state.resumeSeconds, message: player.message }
    // PeerJSのバイナリ変換でundefinedがnullになるため、未設定の任意項目は含めない。
    if (scan) message.scanId = scan.id
    if (this.state.result) message.winner = this.state.result.winner === 'draw' ? 'draw' : this.state.result.winner === 'p1' ? 1 : 2
    return message
  }
  private publish(sendState = true) {
    if (this.disposed) return
    this.onChange(this.snapshot())
    if (sendState) for (const slot of [1, 2] as const) this.transport.sendControl(slot, this.flow(slot))
  }
}
function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : 'スキャンに失敗しました。もう一度お試しください。' }
