import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Scene } from '@babylonjs/core/scene'
import { createWebGL2Engine } from '../../lib/babylon/engine'
import { createFighterMesh } from '../battle/game/fighterMesh'
import type { PreparedFighter } from '../battle/game/fighterPlacement'

export function mountFighterPlacementPreview(canvas: HTMLCanvasElement) {
  const engine = createWebGL2Engine(canvas)
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.1, 0.15, 1)
  const camera = new ArcRotateCamera('placement-camera', Math.PI / 2.8, Math.PI / 2.7, 2.8, new Vector3(0, 0.35, 0), scene)
  camera.lowerRadiusLimit = 1.2
  camera.upperRadiusLimit = 8
  camera.attachControl(canvas, true)
  const ambient = new HemisphericLight('placement-light', Vector3.Up(), scene)
  ambient.intensity = 1

  const floor = MeshBuilder.CreateGround('placement-floor', { width: 3, height: 3 }, scene)
  const floorMaterial = new StandardMaterial('placement-floor-material', scene)
  floorMaterial.diffuseColor = new Color3(0.25, 0.5, 0.4)
  floorMaterial.alpha = 0.3
  floor.material = floorMaterial
  const plane = MeshBuilder.CreateGround('placement-contact-plane', { width: 1.5, height: 1.5 }, scene)
  plane.position.y = 0.002
  const planeMaterial = new StandardMaterial('placement-contact-material', scene)
  planeMaterial.diffuseColor = new Color3(0.2, 0.8, 0.9)
  planeMaterial.alpha = 0.25
  plane.material = planeMaterial
  const ringMaterial = new StandardMaterial('placement-ring-material', scene)
  ringMaterial.diffuseColor = Color3.FromHexString('#2b7bdb')
  ringMaterial.emissiveColor = new Color3(0.05, 0.15, 0.3)
  const ring = MeshBuilder.CreateTorus('placement-ring', { diameter: 1.25, thickness: 0.055, tessellation: 48 }, scene)
  ring.position.y = 0.03
  ring.material = ringMaterial
  const front = MeshBuilder.CreateBox('placement-front', { width: 0.2, height: 0.035, depth: 0.28 }, scene)
  front.position.set(0, 0.06, 0.55)
  front.material = ringMaterial
  const center = MeshBuilder.CreateSphere('placement-center-of-mass', { diameter: 0.04 }, scene)
  const centerMaterial = new StandardMaterial('placement-center-material', scene)
  centerMaterial.emissiveColor = new Color3(1, 0.7, 0.1)
  center.material = centerMaterial
  center.renderingGroupId = 1
  let model: Mesh | undefined
  const resize = new ResizeObserver(() => engine.resize())
  resize.observe(canvas)
  engine.runRenderLoop(() => scene.render())
  return {
    setModel: (prepared: PreparedFighter) => {
      model?.dispose(false, true)
      model = createFighterMesh(scene, 'placement-model', prepared.reconstruction)
      center.position.copyFromFloats(...prepared.centerOfMass)
    },
    dispose: () => {
      engine.stopRenderLoop()
      resize.disconnect()
      camera.detachControl()
      scene.dispose()
      engine.dispose()
    },
  }
}
