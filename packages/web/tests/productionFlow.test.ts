import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test, { type TestContext } from 'node:test'
import { assignScanDirections, SCAN_DIRECTIONS, controlMessageSchema, assetManifestSchema,
  type AssetManifest, type ControlMessage, type PlayerSlot, type SelectionStroke } from '@gikcamp/protocol'
import { BattleRules } from '../src/features/battle/game/battleRules.ts'
import { HostMatch } from '../src/app/host/hostMatch.ts'
import type { BattleFighterModel } from '../src/features/battle/game/fighterPlacement.ts'

const { util } = createRequire(import.meta.url)('peerjs') as typeof import('peerjs')
const stroke: SelectionStroke[] = [{ mode: 'add', points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }] }]
const stats = { hp: 100, attack: 1, reach: 1, turnSpeed: 180, moveSpeed: 1 }
const mask = { width: 8, height: 8, data: Uint8Array.from({ length: 64 }, (_, i) => i > 15 && i < 48 ? 1 : 0) }
const quality = { pixels: 32, fraction: 0.5, touchesEdge: false, needsReview: false, reason: '' }
const look = { bodyUrl: 'data:image/png;base64,AA==', outline: '', bounds: { x: 0, y: 0, width: 100, height: 100 }, eyes: { x: 0, y: 0, width: 40, height: 20 } }
const model = { geometry: { stats } } as BattleFighterModel
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise<void>((resolve) => setImmediate(resolve)) }

function setup(t: TestContext) {
  const controls: { slot: PlayerSlot; message: ControlMessage }[] = []
  const deliveries: AssetManifest[] = []
  const calls = { segments: [] as number[], auto: [] as number[], builds: 0, frame: 0 }
  let failBuild = false, failSegment = false, emptyFront = false, failDelivery = false
  const match = new HostMatch({
    sendControl: (slot, message) => {
      // 実際のcontrol接続と同じバイナリ変換を通し、スマホ側の検証まで確認する。
      const packet = util.pack(message)
      assert.ok(packet instanceof ArrayBuffer)
      controls.push({ slot, message: controlMessageSchema.parse(util.unpack(packet)) })
    },
    sendAsset: async (_slot, blob, details) => {
      if (failDelivery) throw new Error('Mask返送が中断しました。')
      const manifest = { ...details, transferId: details.transferId!, fileName: 'mask.png', mimeType: 'image/png',
        byteLength: blob.size, chunkCount: 1, sha256: '0'.repeat(64) }
      deliveries.push(manifest); return manifest
    },
  }, {
    register: async () => ++calls.frame,
    remove: () => {}, dispose: () => {},
    segment: async (frameId) => {
      calls.segments.push(frameId)
      if (failSegment) throw new Error('対象指定に失敗しました。')
      return { type: 'mask', frameId, jobId: 1, mask: emptyFront ? { ...mask, data: new Uint8Array(64) } : mask,
        quality, timings: { modelLoadMs: 0, resizeMs: 0, setImageMs: 0, segmentMs: 0, conversionMs: 0, totalMs: 0 } }
    },
    auto: async (frameId) => { calls.auto.push(frameId); return { type: 'mask', frameId, jobId: 1, mask, quality,
      timings: { modelLoadMs: 0, resizeMs: 0, setImageMs: 0, segmentMs: 0, conversionMs: 0, totalMs: 0 } } },
    build: async (masks) => { calls.builds += 1; assert.equal(Object.keys(masks).length, 4)
      if (failBuild) throw new Error('モデルの高さが足りません。'); return model },
  }, { maskToBlob: async () => new Blob(['mask']), createScanLook: async () => look }, () => {})
  t.after(() => match.dispose())
  for (const slot of [1, 2] as const) { match.connected(slot); match.control(slot, { type: 'sensor-ready' }) }
  const scan = async (slot: PlayerSlot) => {
    const scanId = crypto.randomUUID(), photoIds = Array.from({ length: 4 }, () => crypto.randomUUID())
    const assigned = assignScanDirections(photoIds, photoIds[2])
    match.control(slot, { type: 'scan-start', scanId, photoIds, frontPhotoId: photoIds[2], strokes: stroke })
    for (const direction of SCAN_DIRECTIONS) await match.asset(slot, { kind: 'photo', transferId: crypto.randomUUID(),
      scan: { scanId, photoId: assigned[direction], direction, revision: 0 }, width: 8, height: 8, fileName: 'photo.jpg', mimeType: 'image/jpeg',
      byteLength: 1, chunkCount: 1, sha256: '0'.repeat(64) }, new Blob(['photo']))
    await flush()
    return scanId
  }
  const latestFlow = (slot: PlayerSlot) => controls.filter((entry) => entry.slot === slot && entry.message.type === 'flow-state').at(-1)!.message as Extract<ControlMessage, { type: 'flow-state' }>
  return { match, controls, deliveries, calls, scan, latestFlow,
    failBuild: () => { failBuild = true }, failSegment: (value: boolean) => { failSegment = value },
    emptyFront: (value: boolean) => { emptyFront = value }, failDelivery: (value: boolean) => { failDelivery = value } }
}

test('QR接続直後と再接続時の画面状態をスマホが受信できる', (t) => {
  const fixture = setup(t)
  for (const slot of [1, 2] as const) {
    const initial = fixture.controls.find((entry) => entry.slot === slot && entry.message.type === 'flow-state')!.message
    assert.ok(initial.type === 'flow-state')
    assert.equal(initial.phase, 'join')
    assert.equal(initial.roundId, fixture.match.snapshot().roundId)
    assert.equal(initial.scanId, undefined)
    assert.equal(initial.winner, undefined)
    assert.equal(fixture.latestFlow(slot).phase, 'capture')
    fixture.match.disconnected(slot)
    fixture.match.connected(slot)
    assert.equal(fixture.latestFlow(slot).phase, 'join')
    fixture.match.control(slot, { type: 'sensor-ready' })
    assert.equal(fixture.latestFlow(slot).phase, 'capture')
  }
})

test('どの写真を正面に選んでも、残りを元の撮影順で右・背面・左へ割り当てる', () => {
  for (let front = 0; front < 4; front += 1) {
    const assigned = assignScanDirections([0, 1, 2, 3], front)
    assert.deepEqual(Object.values(assigned), [front, ...[0, 1, 2, 3].filter((id) => id !== front)])
  }
  assert.throws(() => assignScanDirections([0, 1, 2], 0))
  assert.throws(() => assignScanDirections([0, 0, 2, 3], 0))
})

test('写真4枚・正面・ストロークとマスク版を共有スキーマで検証する', () => {
  const photoIds = Array.from({ length: 4 }, () => crypto.randomUUID())
  const value = { type: 'scan-start', scanId: crypto.randomUUID(), photoIds, frontPhotoId: photoIds[0], strokes: stroke }
  assert.ok(controlMessageSchema.safeParse(value).success)
  for (const invalid of [{ ...value, photoIds: photoIds.slice(1) }, { ...value, frontPhotoId: crypto.randomUUID() },
    { ...value, strokes: [{ mode: 'add', points: [{ x: 2, y: 0 }] }] }, { ...value, strokes: [] },
    { ...value, photoIds: [photoIds[0], photoIds[0], photoIds[2], photoIds[3]] }]) assert.equal(controlMessageSchema.safeParse(invalid).success, false)
  assert.equal(assetManifestSchema.safeParse({ transferId: 'test', kind: 'mask', fileName: 'mask.png', mimeType: 'image/png',
    byteLength: 1, sha256: '0'.repeat(64), chunkCount: 1, width: 2049, height: 1 }).success, false)
})

test('A/Bは能力値をダメージへ反映し、同時HPゼロを引き分けにする', () => {
  const rules = new BattleRules({ p1: { ...stats, hp: 3, attack: 2 }, p2: { ...stats, hp: 6 } })
  assert.deepEqual(rules.step(0, [{ attacker: 'p1', target: 'p2', button: 'a' }, { attacker: 'p2', target: 'p1', button: 'a' }]).result,
    { winner: 'draw', reason: 'hp' })
  const strong = new BattleRules({ p1: { ...stats, attack: 1.3 }, p2: stats })
  assert.ok(Math.abs(strong.step(0, [{ attacker: 'p1', target: 'p2', button: 'b' }]).hp.p2 - 76.6) < 1e-8)
})

test('場外・同時場外・時間切れ・同HPの時間切れを判定する', () => {
  assert.deepEqual(new BattleRules({ p1: stats, p2: stats }).step(0, [], ['p1']).result, { winner: 'p2', reason: 'out' })
  assert.deepEqual(new BattleRules({ p1: stats, p2: stats }).step(0, [], ['p1', 'p2']).result, { winner: 'draw', reason: 'out' })
  assert.deepEqual(new BattleRules({ p1: stats, p2: stats }).step(60).result, { winner: 'draw', reason: 'timeout' })
  const rules = new BattleRules({ p1: stats, p2: stats })
  rules.step(1, [{ attacker: 'p1', target: 'p2', button: 'a' }])
  assert.deepEqual(rules.step(59).result, { winner: 'p1', reason: 'timeout' })
  assert.equal(rules.step(1, [], ['p1']).result?.winner, 'p1')
})

test('PCで攻撃間隔とリング縮小予告を管理する', () => {
  const rules = new BattleRules({ p1: stats, p2: stats })
  assert.equal(rules.acceptAttack('p1', 'a', 0), true)
  assert.equal(rules.acceptAttack('p1', 'a', 399), false)
  assert.equal(rules.acceptAttack('p1', 'a', 400), true)
  assert.equal(rules.acceptAttack('p1', 'b', 400), true)
  assert.equal(rules.acceptAttack('p1', 'b', 3399), false)
  assert.equal(rules.acceptAttack('p1', 'b', 3400), true)
  assert.equal(rules.step(25).shrinkWarning, true)
  assert.equal(rules.step(3).radius, 4.2)
  assert.equal(rules.step(17).shrinkWarning, true)
  assert.equal(rules.step(3).radius, 2.7)
})

test('4枚のMaskを返送し、修正対象だけ再計算して最新の版の確定を受け付ける', async (t) => {
  const fixture = setup(t), scanId = await fixture.scan(1)
  assert.equal(fixture.deliveries.length, 4)
  assert.equal(fixture.latestFlow(1).phase, 'review')
  assert.equal(fixture.latestFlow(1).scanId, scanId)
  assert.equal(fixture.calls.auto.length, 3)
  fixture.match.control(1, { type: 'scan-revise', scanId, direction: 'right', revision: 1, strokes: stroke })
  await flush()
  assert.equal(fixture.calls.segments.length, 2)
  assert.equal(fixture.calls.auto.length, 3)
  assert.equal(fixture.deliveries.at(-1)?.scan?.direction, 'right')
  fixture.match.control(1, { type: 'scan-confirm', scanId, revisions: [0, 0, 0, 0] })
  await flush(); assert.equal(fixture.calls.builds, 0)
  fixture.match.control(1, { type: 'scan-confirm', scanId, revisions: [0, 1, 0, 0] })
  await flush(); assert.equal(fixture.calls.builds, 1)
  assert.equal(fixture.match.snapshot().players[1].status, 'done')
  assert.equal(fixture.match.snapshot().step, 'scan')
})

test('2人分の準備後に開始し、通信断では入力を止め、再準備後3秒で再開する', async (t) => {
  const fixture = setup(t)
  for (const slot of [1, 2] as const) {
    const scanId = await fixture.scan(slot)
    fixture.match.control(slot, { type: 'scan-confirm', scanId, revisions: [0, 0, 0, 0] }); await flush()
  }
  assert.equal(fixture.match.snapshot().step, 'battle')
  assert.equal(fixture.calls.builds, 2)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pauses: boolean[] = [], inputs: unknown[] = [], attacks: unknown[] = []
  fixture.match.attachBattle({ setPaused: (value) => pauses.push(value), setInput: (...values) => inputs.push(values),
    triggerAttack: (...values) => { attacks.push(values); return true } })
  for (let i = 0; i < 3; i += 1) t.mock.timers.tick(1000)
  assert.equal(fixture.match.snapshot().paused, false)
  fixture.match.motion(1, { x: 1, y: 0 }); fixture.match.attack(1, 'a')
  assert.equal(inputs.length, 1); assert.equal(attacks.length, 1)
  fixture.match.disconnected(1)
  fixture.match.motion(1, { x: 1, y: 0 }); fixture.match.attack(1, 'b')
  assert.equal(inputs.length, 1); assert.equal(attacks.length, 1)
  assert.equal(pauses.at(-1), true)
  fixture.match.connected(1)
  t.mock.timers.tick(4000); assert.equal(fixture.match.snapshot().paused, true)
  fixture.match.control(1, { type: 'sensor-ready' })
  for (let i = 0; i < 2; i += 1) t.mock.timers.tick(1000)
  assert.equal(fixture.match.snapshot().paused, true)
  t.mock.timers.tick(1000); assert.equal(fixture.match.snapshot().paused, false)
  fixture.match.battleSnapshot({ hp: { p1: 100, p2: 0 }, remainingSeconds: 30, radius: 6, shrinkWarning: false,
    result: { winner: 'p1', reason: 'hp' } })
  assert.equal(fixture.latestFlow(1).phase, 'result')
  assert.equal(fixture.latestFlow(1).winner, 1)
  const round = fixture.match.snapshot().roundId
  fixture.match.restart()
  assert.equal(fixture.match.snapshot().step, 'lobby')
  assert.notEqual(fixture.match.snapshot().roundId, round)
  assert.equal(fixture.match.snapshot().players[1].model, undefined)
})

test('配置できないモデルは理由を表示し、対象のプレイヤーだけ撮り直しへ戻す', async (t) => {
  const fixture = setup(t), scanId = await fixture.scan(1)
  fixture.failBuild()
  fixture.match.control(1, { type: 'scan-confirm', scanId, revisions: [0, 0, 0, 0] }); await flush()
  assert.equal(fixture.latestFlow(1).phase, 'capture')
  assert.match(fixture.match.snapshot().players[1].message, /高さ/)
  assert.equal(fixture.match.snapshot().players[2].status, 'capturing')
})

async function finishMatch(fixture: ReturnType<typeof setup>, winner: 'p1' | 'draw' = 'p1') {
  for (const slot of [1, 2] as const) {
    const scanId = await fixture.scan(slot)
    fixture.match.control(slot, { type: 'scan-confirm', scanId, revisions: [0, 0, 0, 0] }); await flush()
  }
  fixture.match.battleSnapshot({ hp: { p1: 100, p2: 0 }, remainingSeconds: 30, radius: 6, shrinkWarning: false,
    result: { winner, reason: 'hp' } })
  return fixture.match.snapshot().roundId
}

test('再戦の選択を共有スキーマで検証し、古い試合や重複した選択を無視する', async (t) => {
  const fixture = setup(t), roundId = await finishMatch(fixture)
  const choose = { type: 'rematch-choice', roundId, choice: 'again' } as const
  assert.ok(controlMessageSchema.safeParse(choose).success)
  assert.equal(controlMessageSchema.safeParse({ ...choose, choice: 'invalid' }).success, false)
  assert.equal(controlMessageSchema.safeParse({ ...choose, roundId: 'invalid' }).success, false)
  fixture.match.control(1, { ...choose, roundId: crypto.randomUUID() })
  assert.equal(fixture.latestFlow(1).rematchChoice, undefined)
  fixture.match.control(1, choose)
  assert.equal(fixture.match.snapshot().step, 'result')
  assert.equal(fixture.latestFlow(1).rematchChoice, 'again')
  fixture.match.control(1, { ...choose, choice: 'rescan' })
  assert.equal(fixture.match.snapshot().players[1].rematchChoice, 'again')
  fixture.match.control(2, choose)
  assert.equal(fixture.match.snapshot().step, 'battle')
  assert.notEqual(fixture.match.snapshot().roundId, roundId)
  assert.equal(fixture.match.snapshot().result, null)
  assert.equal(fixture.match.snapshot().players[1].model, model)
  assert.equal(fixture.match.snapshot().players[2].model, model)
  assert.equal(fixture.calls.builds, 2)
  assert.equal(fixture.latestFlow(1).rematchChoice, undefined)
  assert.equal(fixture.latestFlow(1).winner, undefined)
  fixture.match.control(1, choose)
  assert.equal(fixture.match.snapshot().players[1].rematchChoice, undefined)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pauses: boolean[] = []
  fixture.match.attachBattle({ setPaused: (value) => pauses.push(value), setInput: () => {}, triggerAttack: () => true })
  assert.equal(fixture.latestFlow(1).resumeSeconds, 3)
  for (let i = 0; i < 3; i += 1) t.mock.timers.tick(1000)
  assert.equal(pauses.at(-1), false)
})

test('引き分けでも再戦でき、切断後の選択を保持して基準姿勢の再取得を待つ', async (t) => {
  const fixture = setup(t), roundId = await finishMatch(fixture, 'draw')
  fixture.match.control(1, { type: 'rematch-choice', roundId, choice: 'again' })
  fixture.match.disconnected(1)
  fixture.match.control(2, { type: 'rematch-choice', roundId, choice: 'again' })
  assert.equal(fixture.match.snapshot().step, 'result')
  fixture.match.connected(1)
  assert.equal(fixture.latestFlow(1).rematchChoice, 'again')
  assert.equal(fixture.match.snapshot().step, 'result')
  fixture.match.control(1, { type: 'sensor-ready' })
  assert.equal(fixture.match.snapshot().step, 'battle')
})

for (const otherChoice of ['again', 'rescan'] as const) {
  test(`撮り直しを選んだ側だけ撮影へ戻す（相手は${otherChoice}）`, async (t) => {
    const fixture = setup(t), roundId = await finishMatch(fixture)
    fixture.match.control(1, { type: 'rematch-choice', roundId, choice: 'rescan' })
    fixture.match.control(2, { type: 'rematch-choice', roundId, choice: otherChoice })
    assert.equal(fixture.match.snapshot().step, 'scan')
    assert.equal(fixture.match.snapshot().players[1].model, undefined)
    assert.equal(fixture.match.snapshot().players[1].look, undefined)
    assert.equal(fixture.latestFlow(1).phase, 'capture')
    assert.equal(fixture.latestFlow(1).scanId, undefined)
    assert.equal(fixture.latestFlow(2).phase, otherChoice === 'again' ? 'waiting' : 'capture')
    for (const slot of (otherChoice === 'again' ? [1] : [1, 2]) as PlayerSlot[]) {
      const scanId = await fixture.scan(slot)
      fixture.match.control(slot, { type: 'scan-confirm', scanId, revisions: [0, 0, 0, 0] }); await flush()
    }
    assert.equal(fixture.match.snapshot().step, 'battle')
    assert.equal(fixture.calls.builds, otherChoice === 'again' ? 3 : 4)
  })
}

test('空の正面Maskは修正でき、成功後に残る3方向を生成する', async (t) => {
  const fixture = setup(t); fixture.emptyFront(true)
  const scanId = await fixture.scan(1)
  assert.equal(fixture.calls.auto.length, 0)
  fixture.match.control(1, { type: 'scan-confirm', scanId, revisions: [0, 0, 0, 0] })
  assert.equal(fixture.calls.builds, 0)
  fixture.emptyFront(false)
  fixture.match.control(1, { type: 'scan-revise', scanId, direction: 'front', revision: 1, strokes: stroke }); await flush()
  assert.equal(fixture.calls.auto.length, 3)
  assert.equal(fixture.deliveries.length, 5)
})

test('修正Workerの失敗は再試行でき、Mask返送中断後も不足方向を生成して送り直す', async (t) => {
  const fixture = setup(t), scanId = await fixture.scan(1)
  fixture.failSegment(true)
  fixture.match.control(1, { type: 'scan-revise', scanId, direction: 'right', revision: 1, strokes: stroke }); await flush()
  assert.ok(fixture.controls.some((entry) => entry.message.type === 'scan-revision-failed'))
  fixture.failSegment(false)
  fixture.match.control(1, { type: 'scan-revise', scanId, direction: 'right', revision: 1, strokes: stroke }); await flush()
  assert.equal(fixture.deliveries.at(-1)?.scan?.revision, 1)
  fixture.failDelivery(true)
  const second = await fixture.scan(2)
  assert.equal(fixture.latestFlow(2).phase, 'review')
  fixture.failDelivery(false)
  fixture.match.control(2, { type: 'scan-resend-masks', scanId: second }); await flush()
  assert.equal(fixture.calls.auto.length, 6)
  assert.equal(fixture.deliveries.filter((manifest) => manifest.scan?.scanId === second).length, 4)
})

test('撮り直し後に届いた旧スキャンの写真・修正・確定は受け付けない', async (t) => {
  const fixture = setup(t), scanId = await fixture.scan(1)
  fixture.match.control(1, { type: 'scan-retry', scanId })
  const before = fixture.calls.segments.length
  fixture.match.control(1, { type: 'scan-revise', scanId, direction: 'front', revision: 1, strokes: stroke })
  fixture.match.control(1, { type: 'scan-confirm', scanId, revisions: [0, 0, 0, 0] })
  await flush()
  assert.equal(fixture.calls.segments.length, before); assert.equal(fixture.calls.builds, 0)
})
