import { useEffect, useRef, useState } from 'react'
import type {
  AssetManifest,
  MotionMessage,
  PlayerSlot,
} from '@gikcamp/protocol'
import {
  LobbyScreen,
  type LobbyPlayerStatus,
} from '../../features/lobby/LobbyScreen.tsx'
import { HostPeerSession } from '../../lib/peer/hostPeerSession.ts'
import { buildControllerUrl } from '../../lib/peer/pairing.ts'
import '../../../../../docs/design/tokens.css'
import './host.css'

type PlayerConnections = Record<
  PlayerSlot,
  string | null
>

type ControllerUrls = Record<PlayerSlot, string>
type PlayerValue<T> = Record<PlayerSlot, T>

type ReceivedPhoto = {
  manifest: AssetManifest
  url: string
}

const createPlayerStatus = (
  connected: boolean,
): LobbyPlayerStatus => ({
  connected,
  sensorReady: false,
  ready: false,
})

export function HostFlow() {
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
        setPlayers((current) => ({
          ...current,
          [slot]: null,
        }))
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

  return (
    <>
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

      <aside className="host-diagnostics" aria-label="通信確認">
        {([1, 2] as const).map((slot) => (
          <section key={slot} className="host-diagnostics__player">
            <strong>Player {slot}</strong>
            <span>Peer ID: {players[slot] ?? '未接続'}</span>
            <span>
              傾き:
              {' '}
              {motions[slot] === null
                ? '-'
                : `x=${motions[slot].x.toFixed(2)}, y=${motions[slot].y.toFixed(2)}`}
            </span>
            <span>ボタン: {buttons[slot]?.toUpperCase() ?? '-'}</span>
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
    </>
  )
}
