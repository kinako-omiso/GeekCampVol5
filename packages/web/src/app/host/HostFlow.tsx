import { useEffect, useState } from 'react'
import type { PlayerSlot } from '@gikcamp/protocol'
import {
  LobbyScreen,
  type LobbyPlayerStatus,
} from '../../features/lobby/LobbyScreen.tsx'
import { HostPeerSession } from '../../lib/peer/hostPeerSession.ts'
import { buildControllerUrl } from '../../lib/peer/pairing.ts'
import '../../../../../docs/design/tokens.css'

type PlayerConnections = Record<
  PlayerSlot,
  string | null
>

type ControllerUrls = Record<PlayerSlot, string>

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

  useEffect(() => {
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

      error: (peerError) => {
        setError(peerError.message)
      },
    })

    return () => {
      session.destroy()
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
    <LobbyScreen
      joinUrls={{
        p1: controllerUrls[1],
        p2: controllerUrls[2],
      }}
      statuses={{
        p1: createPlayerStatus(
          players[1] !== null,
        ),
        p2: createPlayerStatus(
          players[2] !== null,
        ),
      }}
    />
  )
}