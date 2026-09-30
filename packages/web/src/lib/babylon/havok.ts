import HavokPhysics from '@babylonjs/havok'
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin'
import type { Scene } from '@babylonjs/core/scene'
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent'
import '@babylonjs/core/Physics/v2/physicsEngineComponent'

let havokPromise: ReturnType<typeof HavokPhysics> | undefined

/** 画面を開いたときだけ Havok Wasm を読み込む。 */
export async function enableHavok(scene: Scene): Promise<void> {
  try {
    havokPromise ??= HavokPhysics({ locateFile: () => havokWasmUrl })
    const havok = await havokPromise
    if (!scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok))) {
      throw new Error('物理シーンを有効化できませんでした。')
    }
    scene.getPhysicsEngine()?.setTimeStep(1 / 60)
  } catch (cause) {
    havokPromise = undefined
    throw new Error('Havok Wasm を初期化できませんでした。', { cause })
  }
}
