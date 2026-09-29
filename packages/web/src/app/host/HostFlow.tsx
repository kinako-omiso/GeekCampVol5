import { useEffect, useState } from 'react'
import type { PlayerSlot } from '@gikcamp/protocol'
import { LobbyScreen } from '../../features/lobby/LobbyScreen.tsx'
import { HostPeerSession } from '../../lib/peer/hostPeerSession.ts'
import { buildControllerUrl } from '../../lib/peer/pairing.ts'

type PlayerConnections = Record<PlayerSlot, string | null>
type ControllerUrls = Record<PlayerSlot, string>

export function HostFlow() {
  const [hostPeerId, setHostPeerId] = useState('')
  const [controllerUrls, setControllerUrls] =
    useState<ControllerUrls | null>(null)

  const [players, setPlayers] = useState<PlayerConnections>({
    1: null,
    2: null,
  })

  const [error, setError] = useState('')

  useEffect(() => {
    const session = new HostPeerSession({
      ready: (peerId, metadata) => {
        setHostPeerId(peerId)

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

      playerConnected: (slot, controllerPeerId) => {
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

  return (
    <LobbyScreen
      hostPeerId={hostPeerId}
      controllerUrls={controllerUrls}
      players={players}
      error={error}
    />
  )
}