import assert from 'node:assert/strict'
import test from 'node:test'
import { ASSET_CHUNK_SIZE, type AssetMessage, type AssetManifest } from '@gikcamp/protocol'
import { AssetTransport } from '../src/lib/peer/assetTransport.ts'

function pair() {
  const received: { side: number; manifest: AssetManifest; blob: Blob }[] = []
  let corrupt = false, drop = false
  const connection1 = { open: true, send: (message: AssetMessage) => {
    if (drop) return
    const packet = structuredClone(message)
    if (corrupt && packet.type === 'asset-chunk') new Uint8Array(packet.data)[0] ^= 1
    queueMicrotask(() => { void second.receive(packet) })
  } }
  const connection2 = { open: true, send: (message: AssetMessage) => queueMicrotask(() => { void first.receive(structuredClone(message)) }) }
  const first = new AssetTransport(connection1, { received: (manifest, blob) => received.push({ side: 1, manifest, blob }) })
  const second = new AssetTransport(connection2, { received: (manifest, blob) => received.push({ side: 2, manifest, blob }) })
  return { first, second, received, corrupt: (value: boolean) => { corrupt = value }, drop: () => { drop = true },
    close: () => { first.dispose(); second.dispose() } }
}

test('写真とMaskを同じasset接続で双方向にチャンク転送し、全バイトを検証する', async (t) => {
  const fixture = pair(); t.after(fixture.close)
  const bytes = Uint8Array.from({ length: ASSET_CHUNK_SIZE * 2 + 321 }, (_, index) => index % 251)
  const progress: number[] = []
  await fixture.first.send(new Blob([bytes], { type: 'image/jpeg' }), { kind: 'photo', width: 640, height: 480 }, (ratio) => progress.push(ratio))
  await fixture.second.send(new Blob(['mask'], { type: 'image/png' }), { kind: 'mask', width: 64, height: 48 })
  assert.equal(fixture.received.length, 2)
  assert.deepEqual(new Uint8Array(await fixture.received[0].blob.arrayBuffer()), bytes)
  assert.equal(fixture.received[0].manifest.chunkCount, 3)
  assert.equal(fixture.received[1].side, 1)
  assert.equal(progress.at(-1), 1)
})

test('ハッシュ不一致を拒否し、同じ写真を全体再送して成功できる', async (t) => {
  const fixture = pair(); t.after(fixture.close)
  const blob = new Blob(['photo'], { type: 'image/jpeg' })
  fixture.corrupt(true)
  await assert.rejects(fixture.first.send(blob, { kind: 'photo', width: 64, height: 64 }), /ハッシュ/)
  assert.equal(fixture.received.length, 0)
  fixture.corrupt(false)
  await fixture.first.send(blob, { kind: 'photo', width: 64, height: 64 })
  assert.equal(fixture.received.length, 1)
})

test('通信断は受信確認待ちのPromiseを終了する', async (t) => {
  const fixture = pair(); t.after(fixture.close); fixture.drop()
  const sending = fixture.first.send(new Blob(['photo'], { type: 'image/jpeg' }), { kind: 'photo', width: 64, height: 64 })
  await new Promise<void>((resolve) => setImmediate(resolve))
  fixture.first.dispose()
  await assert.rejects(sending, /接続が切れました/)
})

test('寸法・空データ・不正なチャンクサイズを拒否する', async (t) => {
  const fixture = pair(); t.after(fixture.close)
  await assert.rejects(fixture.first.send(new Blob([]), { kind: 'photo', width: 64, height: 64 }))
  await assert.rejects(fixture.first.send(new Blob(['photo']), { kind: 'photo', width: 2049, height: 64 }))
  const replies: AssetMessage[] = []
  const receiver = new AssetTransport({ open: true, send: (message) => replies.push(message) }, { received: () => assert.fail('不正なデータは受信しない') })
  t.after(() => receiver.dispose())
  const manifest = { transferId: 'test', kind: 'photo' as const, fileName: 'photo.jpg', mimeType: 'image/jpeg',
    byteLength: ASSET_CHUNK_SIZE + 2, chunkCount: 2, sha256: '0'.repeat(64), width: 64, height: 64 }
  await receiver.receive({ type: 'asset-manifest', manifest })
  await receiver.receive({ type: 'asset-chunk', transferId: 'test', index: 0, data: new ArrayBuffer(2) })
  assert.equal(replies.at(-1)?.type, 'asset-rejected')
})
