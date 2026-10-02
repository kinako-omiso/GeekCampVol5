import { Engine } from '@babylonjs/core/Engines/engine'

/** 検証シーン用の WebGL2 エンジンを作る。 */
export function createWebGL2Engine(canvas: HTMLCanvasElement): Engine {
  if (!canvas.getContext('webgl2')) throw new Error('WebGL2に対応したPCブラウザで開いてください。')
  const engine = new Engine(canvas, true, { disableWebGL2Support: false })
  if (engine.webGLVersion < 2) {
    engine.dispose()
    throw new Error('WebGL2を初期化できませんでした。')
  }
  return engine
}
