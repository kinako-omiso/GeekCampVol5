import { useEffect, useRef, useState } from 'react'
import type {
  AssetManifest,
  FighterStats,
  MotionMessage,
  PlayerSlot,
} from '@gikcamp/protocol'
import { HostStage } from '../../components/HostStage'
import { ScanProgressScreen, type ScanStatus } from '../../features/analyze/ScanProgressScreen'
import { BattleHud } from '../../features/battle/ui/BattleHud'
import { EntranceScreen } from '../../features/entrance/EntranceScreen'
import { LobbyScreen, type LobbyPlayerStatus } from '../../features/lobby/LobbyScreen'
import { ResultScreen } from '../../features/result/ResultScreen'
import { HostPeerSession } from '../../lib/peer/hostPeerSession.ts'
import { buildControllerUrl } from '../../lib/peer/pairing.ts'
import { MOCK_SCANNEES } from './mock/mockScannees'
import type { PlayerId } from '../../../../../docs/design/tokens'
import mugUrl from '../../../../../docs/design/assets/sample-scannee-mug.svg'
import eraserUrl from '../../../../../docs/design/assets/sample-scannee-eraser.svg'
import '../../../../../docs/design/tokens.css'
import './host.css'

type Step = 'lobby' | 'scan' | 'entrance' | 'battle' | 'result'

// モック：スキャンの進み方。解析は1人ずつなので、2P は 1P の解析が終わるまで待つ
const MOCK_SCAN_STEPS: Record<PlayerId, ScanStatus>[] = [
  { p1: 'capturing', p2: 'capturing' },
  { p1: 'sending', p2: 'capturing' },
  { p1: 'analyzing', p2: 'sending' },
  { p1: 'analyzing', p2: 'waiting' },
  { p1: 'done', p2: 'analyzing' },
  { p1: 'done', p2: 'done' },
]

// モック：能力値は docs/04-mvp.md の表示例に合わせたサンプル。HP は試合の途中くらいの値
const MOCK_STATS: Record<PlayerId, FighterStats> = {
  p1: { hp: 128, attack: 1.05, reach: 1.01, turnSpeed: 192, moveSpeed: 0.89 },
  p2: { hp: 110, attack: 1.2, reach: 0.89, turnSpeed: 228, moveSpeed: 1.02 },
}
const MOCK_HP: Record<PlayerId, number> = { p1: 72, p2: 38 }
const MOCK_REMAINING_SECONDS = 24

// 送られてきた後（順番待ち・解析中・完成）だけコマの見た目がある
function hasLook(status: ScanStatus) {
  return status === 'waiting' || status === 'analyzing' || status === 'done'
}

type PlayerConnections = Record<PlayerSlot, string | null>
type ControllerUrls = Record<PlayerSlot, string>
type PlayerValue<T> = Record<PlayerSlot, T>

type ReceivedPhoto = {
  manifest: AssetManifest
  url: string
}

// 接続確認用定数
const SHOW_HOST_DIAGNOSTICS = true

const createPlayerStatus = (
  connected: boolean,
): LobbyPlayerStatus => ({
  connected,
  sensorReady: false,
  ready: false,
})

export function HostFlow() {
  const [step, setStep] = useState<Step>('lobby')
  const [scanStep, setScanStep] = useState(0)
  const [winner, setWinner] = useState<PlayerId>('p1')
  const [controllerUrls, setControllerUrls] =
    useState<ControllerUrls | null>(null)

  const [players, setPlayers] =
    useState<PlayerConnections>({
      1: null,
      2: null,
    })

  const [error, setError] = useState('')
  const [motions, setMotions] =
    useState<PlayerValue<MotionMessage | null>>({
      1: null,
      2: null,
    })
  const [buttons, setButtons] =
    useState<PlayerValue<'a' | 'b' | null>>({
      1: null,
      2: null,
    })
  const [assetProgress, setAssetProgress] =
    useState<PlayerValue<number>>({
      1: 0,
      2: 0,
    })
  const [photos, setPhotos] =
    useState<Partial<Record<PlayerSlot, ReceivedPhoto>>>({})
  const photoUrlsRef =
    useRef<Partial<Record<PlayerSlot, string>>>({})

  useEffect(() => {
    const photoUrls = photoUrlsRef.current

    const resetPlayer = (slot: PlayerSlot) => {
      const photoUrl = photoUrls[slot]

      if (photoUrl !== undefined) {
        URL.revokeObjectURL(photoUrl)
        delete photoUrls[slot]
      }

      setPlayers((current) => ({
        ...current,
        [slot]: null,
      }))
      setMotions((current) => ({
        ...current,
        [slot]: null,
      }))
      setButtons((current) => ({
        ...current,
        [slot]: null,
      }))
      setAssetProgress((current) => ({
        ...current,
        [slot]: 0,
      }))
      setPhotos((current) => {
        const next = { ...current }
        delete next[slot]
        return next
      })
    }

    const session = new HostPeerSession({
      ready: (peerId, metadata) => {
        setControllerUrls({
          1: buildControllerUrl(
            window.location.origin,
            peerId,
            metadata[1],
          ),
          2: buildControllerUrl(
            window.location.origin,
            peerId,
            metadata[2],
          ),
        })
      },

      playerConnected: (
        slot,
        controllerPeerId,
      ) => {
        setPlayers((current) => ({
          ...current,
          [slot]: controllerPeerId,
        }))
      },

      playerDisconnected: (slot) => {
        resetPlayer(slot)
      },

      motionReceived: (slot, message) => {
        setMotions((current) => ({
          ...current,
          [slot]: message,
        }))
      },

      buttonPressed: (slot, button) => {
        setButtons((current) => ({
          ...current,
          [slot]: button,
        }))
      },

      assetProgress: (slot, receivedBytes, totalBytes) => {
        setAssetProgress((current) => ({
          ...current,
          [slot]: receivedBytes / totalBytes,
        }))
      },

      assetReceived: (slot, manifest, blob) => {
        const previousUrl = photoUrls[slot]
        if (previousUrl !== undefined) {
          URL.revokeObjectURL(previousUrl)
        }

        const url = URL.createObjectURL(blob)
        photoUrls[slot] = url
        setPhotos((current) => ({
          ...current,
          [slot]: { manifest, url },
        }))
      },

      error: (peerError) => {
        setError(peerError.message)
      },
    })

    return () => {
      session.destroy()
      for (const url of Object.values(photoUrls)) {
        if (url !== undefined) URL.revokeObjectURL(url)
      }
    }
  }, [])

  if (error !== '') {
    return (
      <main>
        <h1>スマホを接続</h1>
        <p role="alert">{error}</p>
      </main>
    )
  }

  if (controllerUrls === null) {
    return (
      <main>
        <h1>スマホを接続</h1>
        <p>QRコードを準備中...</p>
      </main>
    )
  }

  const scanStatuses = MOCK_SCAN_STEPS[scanStep]
  const scanIsLast = scanStep === MOCK_SCAN_STEPS.length - 1

  const finish = (player: PlayerId) => {
    setWinner(player)
    setStep('result')
  }

  const restart = () => {
    setScanStep(0)
    setStep('lobby')
  }

  return (
    <>
      {step === 'lobby' && (
        <LobbyScreen
          joinUrls={{
            p1: controllerUrls[1],
            p2: controllerUrls[2],
          }}
          statuses={{
            p1: {
              ...createPlayerStatus(players[1] !== null),
              sensorReady: motions[1] !== null,
              ready: motions[1] !== null,
            },
            p2: {
              ...createPlayerStatus(players[2] !== null),
              sensorReady: motions[2] !== null,
              ready: motions[2] !== null,
            },
          }}
        />
      )}
      {step === 'scan' && (
        <ScanProgressScreen
          players={{
            p1: { status: scanStatuses.p1, look: hasLook(scanStatuses.p1) ? MOCK_SCANNEES.p1 : undefined },
            p2: { status: scanStatuses.p2, look: hasLook(scanStatuses.p2) ? MOCK_SCANNEES.p2 : undefined },
          }}
        />
      )}
      {step === 'entrance' && (
        <EntranceScreen
          fighters={{
            p1: { look: MOCK_SCANNEES.p1, stats: MOCK_STATS.p1 },
            p2: { look: MOCK_SCANNEES.p2, stats: MOCK_STATS.p2 },
          }}
          onDone={() => setStep('battle')}
        />
      )}
      {step === 'battle' && (
        <HostStage>
          <BattleHud
            fighters={{
              p1: { hp: MOCK_HP.p1, stats: MOCK_STATS.p1, portraitUrl: mugUrl },
              p2: { hp: MOCK_HP.p2, stats: MOCK_STATS.p2, portraitUrl: eraserUrl },
            }}
            remainingSeconds={MOCK_REMAINING_SECONDS}
          />
        </HostStage>
      )}
      {step === 'result' && <ResultScreen winner={winner} looks={MOCK_SCANNEES} />}

      <div className="host-mock">
        {step === 'lobby' && (
          <>
            <button type="button" onClick={() => setStep('scan')}>
              モック：スキャンへ ▶
            </button>
          </>
        )}
        {step === 'scan' && (
          <button
            type="button"
            onClick={() => (scanIsLast ? setStep('entrance') : setScanStep((current) => current + 1))}
          >
            {scanIsLast ? 'モック：とうじょうへ ▶' : 'モック：すすめる ▶'}
          </button>
        )}
        {step === 'entrance' && (
          <button type="button" onClick={() => setStep('battle')}>
            モック：とばす ▶
          </button>
        )}
        {step === 'battle' && (
          <>
            <button type="button" onClick={() => finish('p1')}>
              モック：1Pのかち ▶
            </button>
            <button type="button" onClick={() => finish('p2')}>
              モック：2Pのかち ▶
            </button>
          </>
        )}
        {step === 'result' && (
          <button type="button" onClick={restart}>
            モック：ロビーへ ▶
          </button>
        )}
      </div>

      {SHOW_HOST_DIAGNOSTICS && (
        <aside
          className="host-diagnostics"
          aria-label="通信確認"
        >
          {([1, 2] as const).map((slot) => (
            <section
              key={slot}
              className="host-diagnostics__player"
            >
              <strong>Player {slot}</strong>

              <span>
                Peer ID: {players[slot] ?? '未接続'}
              </span>

              <span>
                傾き:
                {' '}
                {motions[slot] === null
                  ? '-'
                  : `x=${motions[slot].x.toFixed(2)}, y=${motions[slot].y.toFixed(2)}`}
              </span>

              <span>
                ボタン:
                {' '}
                {buttons[slot]?.toUpperCase() ?? '-'}
              </span>

              <span>
                写真:
                {' '}
                {photos[slot] === undefined
                  ? `${Math.round(assetProgress[slot] * 100)}%`
                  : `受信済み ${photos[slot].manifest.width}×${photos[slot].manifest.height}`}
              </span>

              {photos[slot]?.manifest.kind === 'photo' && (
                <img
                  src={photos[slot].url}
                  alt={`Player ${slot}から受信した写真`}
                />
              )}
            </section>
          ))}
        </aside>
      )}
    </>
  )
}
