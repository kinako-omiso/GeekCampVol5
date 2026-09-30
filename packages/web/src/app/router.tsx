import { createBrowserRouter, Navigate } from 'react-router'

// 画面ごとに遅延読み込みする（Babylon.js・MediaPipe を最初に読み込まないため）
export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/host" replace /> },
  {
    path: '/host',
    lazy: async () => ({
      Component: (await import('./host/HostFlow')).HostFlow,
    }),
  },
  {
    path: '/controller',
    lazy: async () => ({
      Component: (await import('./controller/ControllerFlow')).ControllerFlow,
    }),
  },
  {
    path: '/dev/sensor',
    lazy: async () => ({
      Component: (await import('../dev/sensor/SensorPage')).SensorPage,
    }),
  },
  {
    path: '/dev/peer',
    lazy: async () => ({
      Component: (await import('../dev/peer/PeerPage')).PeerPage,
    }),
  },
  {
    path: '/dev/babylon',
    lazy: async () => ({
      Component: (await import('../dev/babylon/BabylonPage')).BabylonPage,
    }),
  },
  {
    path: '/dev/physics',
    lazy: async () => ({
      Component: (await import('../dev/physics/PhysicsPage')).PhysicsPage,
    }),
  },
  {
    path: '/dev/battle-hud',
    lazy: async () => ({
      Component: (await import('../dev/battle-hud/BattleHudPage')).BattleHudPage,
    }),
  },
  {
    path: '/dev/visual-hull',
    lazy: async () => ({
      Component: (await import('../dev/visual-hull/VisualHullPage')).default,
    }),
  },
  {
    path: '/dev/photo-model',
    lazy: async () => ({
      Component: (await import('../dev/photo-model/PhotoModelPage')).default,
    }),
  },
])