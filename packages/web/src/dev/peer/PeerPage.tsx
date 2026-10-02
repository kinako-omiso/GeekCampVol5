import { lazy, Suspense } from 'react'
import { PeerTest } from './peerTest'

const PeerController = lazy(async () => ({
  default: (await import('./PeerController')).PeerController,
}))

export function PeerPage() {
  const hostId = new URLSearchParams(window.location.search).get('host')?.trim()
  return hostId
    ? <Suspense fallback={<p>スマホ操作画面を読み込んでいます</p>}><PeerController hostId={hostId} /></Suspense>
    : <PeerTest />
}
