import { QRCodeSVG } from 'qrcode.react'
import type { PlayerSlot } from '@gikcamp/protocol'

type PlayerConnections = Record<PlayerSlot, string | null>
type ControllerUrls = Record<PlayerSlot, string>

type Props = {
  hostPeerId: string
  controllerUrls: ControllerUrls | null
  players: PlayerConnections
  error: string
}

const PLAYER_SLOTS = [1, 2] as const

export function LobbyScreen({
  hostPeerId,
  controllerUrls,
  players,
  error,
}: Props) {
  return (
    <main>
      <h1>スマホを接続</h1>

      <p>
        PCのPeer ID:
        {' '}
        {hostPeerId || '取得中...'}
      </p>

      {error !== '' && (
        <p role="alert">{error}</p>
      )}

      <div>
        {PLAYER_SLOTS.map((slot) => (
          <section key={slot}>
            <h2>Player {slot}</h2>

            {controllerUrls === null ? (
              <p>QRコードを準備中...</p>
            ) : (
              <QRCodeSVG
                value={controllerUrls[slot]}
                size={220}
                level="M"
              />
            )}

            <p>
              {players[slot] === null
                ? '接続待ち'
                : `接続済み: ${players[slot]}`}
            </p>
          </section>
        ))}
      </div>
    </main>
  )
}