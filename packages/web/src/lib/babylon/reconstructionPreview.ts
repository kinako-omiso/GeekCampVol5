import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { Engine } from '@babylonjs/core/Engines/engine'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Scene } from '@babylonjs/core/scene'
import type { ReconstructionResult } from '../../features/analyze/reconstruction/types'

export function mountReconstructionPreview(canvas: HTMLCanvasElement, reconstruction: ReconstructionResult): () => void {
  if (!canvas.getContext('webgl2')) throw new Error('WebGL2に対応したPCブラウザで開いてください。')

  const engine = new Engine(canvas, true, { disableWebGL2Support: false })
  if (engine.webGLVersion < 2) {
    engine.dispose()
    throw new Error('WebGL2を初期化できませんでした。')
  }

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.1, 0.15, 1)
  const vertexData = new VertexData()
  vertexData.positions = reconstruction.positions
  vertexData.indices = reconstruction.indices
  if (reconstruction.normals) vertexData.normals = reconstruction.normals
  const mesh = new Mesh('quick-scan-model', scene)
  vertexData.applyToMesh(mesh)

  const material = new StandardMaterial('quick-scan-gray', scene)
  material.diffuseColor = Color3.FromHexString('#dddddd')
  material.specularColor = new Color3(0.12, 0.12, 0.12)
  material.backFaceCulling = true
  mesh.material = material

  const bounds = mesh.getBoundingInfo().boundingBox
  const targetY = (bounds.minimumWorld.y + bounds.maximumWorld.y) / 2
  const camera = new ArcRotateCamera('preview-camera', Math.PI / 2, Math.PI / 2.7, 2.3, new Vector3(0, targetY, 0), scene)
  camera.lowerRadiusLimit = 1.1
  camera.upperRadiusLimit = 5
  camera.wheelDeltaPercentage = 0.01
  camera.attachControl(canvas, true)

  const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene)
  ambient.intensity = 0.8
  const key = new DirectionalLight('key', new Vector3(-0.4, -0.7, -1), scene)
  key.intensity = 0.9

  const resizeObserver = new ResizeObserver(() => engine.resize())
  resizeObserver.observe(canvas)
  engine.runRenderLoop(() => scene.render())
  return () => {
    resizeObserver.disconnect()
    camera.detachControl()
    scene.dispose()
    engine.dispose()
  }
}
