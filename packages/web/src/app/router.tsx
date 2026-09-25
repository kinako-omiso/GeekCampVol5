import { Suspense, lazy } from 'react'

const PhotoModelPage = lazy(() => import('../dev/photo-model/PhotoModelPage'))

export function AppRouter() {
  if (window.location.pathname === '/dev/photo-model') {
    return <Suspense fallback={<p>Quick Scanを読み込んでいます…</p>}><PhotoModelPage /></Suspense>
  }
  return <main style={{ padding: 32 }}><h1>GikCamp Vol.5</h1><a href="/dev/photo-model">Quick Scan 検証画面を開く</a></main>
}
