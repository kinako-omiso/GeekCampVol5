import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), {
    name: 'mediapipe-wasm-loader-dev',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0]
        if (!request.url?.includes('?import') ||
          (path !== '/mediapipe/wasm/vision_wasm_internal.js' && path !== '/mediapipe/wasm/vision_wasm_nosimd_internal.js')) {
          next()
          return
        }
        // MediaPipeの動的importはViteに?importを付けられるため、同梱ローダーをそのまま返す。
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        response.end(readFileSync(new URL(`./public${path}`, import.meta.url)))
      })
    },
  }],
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
  },
})
