import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Scene } from '@babylonjs/core/scene'
import { getVolumeCentroid } from '../../analyze/reconstruction/centroid'
import { reconstructQuickScan } from '../../analyze/reconstruction/quickScan'
import { createWebGL2Engine } from '../../../lib/babylon/engine'
import { stepMovement, type MotionInput, type MovementState } from './movement'
import { createSampleMask } from './sampleMask'

type AttackButton = 'a' | 'b'
type AttackState = { button: AttackButton; startedAt: number }

export type DevBattle = {
  setMotion: (motion: MotionInput) => void
  stop: () => void
  attack: (button: AttackButton) => boolean
  setInspecting: (inspecting: boolean) => void
  dispose: () => void
}

function attackOffset(attack: AttackState | null, now: number): number {
  if (!attack) return 0
  const elapsed = (now - attack.startedAt) / 1000
  if (attack.button === 'a') {
    if (elapsed >= 0.4) return 0
    return elapsed < 0.14 ? 0.55 * elapsed / 0.14 : 0.55 * (0.4 - elapsed) / 0.26
  }
  if (elapsed < 0.3) return -0.3 * elapsed / 0.3
  if (elapsed < 0.55) return -0.3 + 1.4 * (elapsed - 0.3) / 0.25
  if (elapsed < 0.85) return 1.1 * (0.85 - elapsed) / 0.3
  return 0
}

/** 1人分の描画・操作を確認するシーン。対戦の物理と勝敗は扱わない。 */
export function mountDevBattle(canvas: HTMLCanvasElement): DevBattle {
  const engine = createWebGL2Engine(canvas)
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.73, 0.87, 0.96, 1)

  const ground = MeshBuilder.CreateCylinder('arena', { diameter: 12, height: 0.12, tessellation: 64 }, scene)
  ground.position.y = -0.06
  const groundMaterial = new StandardMaterial('arena-grass', scene)
  groundMaterial.diffuseColor = Color3.FromHexString('#81bd69')
  ground.material = groundMaterial

  const reconstruction = reconstructQuickScan(createSampleMask())
  const vertexData = new VertexData()
  vertexData.positions = reconstruction.positions
  vertexData.indices = reconstruction.indices
  if (reconstruction.normals) vertexData.normals = reconstruction.normals
  const mesh = new Mesh('quick-scan-fighter', scene)
  vertexData.applyToMesh(mesh)
  const bodyMaterial = new StandardMaterial('quick-scan-gray', scene)
  bodyMaterial.diffuseColor = Color3.FromHexString('#dddddd')
  bodyMaterial.specularColor = new Color3(0.12, 0.12, 0.12)
  bodyMaterial.sideOrientation = Material.ClockWiseSideOrientation
  mesh.material = bodyMaterial

  const actor = new TransformNode('fighter-position', scene)
  const lunge = new TransformNode('fighter-attack', scene)
  lunge.parent = actor
  const inspection = new TransformNode('fighter-inspection', scene)
  inspection.parent = lunge
  inspection.position.y = 0.65
  inspection.rotationQuaternion = Quaternion.Identity()
  const center = getVolumeCentroid(reconstruction)
  mesh.parent = inspection
  mesh.position.set(-(center?.x ?? 0), -(center?.y ?? 0), -(center?.z ?? 0))

  const ring = MeshBuilder.CreateTorus('player-ring', { diameter: 1.25, thickness: 0.055, tessellation: 48 }, scene)
  ring.parent = actor
  ring.position.y = 0.05
  const ringMaterial = new StandardMaterial('player-blue', scene)
  ringMaterial.diffuseColor = Color3.FromHexString('#2b7bdb')
  ringMaterial.emissiveColor = Color3.FromHexString('#174080')
  ring.material = ringMaterial

  const front = MeshBuilder.CreateBox('front-marker', { width: 0.2, height: 0.035, depth: 0.28 }, scene)
  front.parent = actor
  front.position.set(0, 0.07, 0.55)
  front.material = ringMaterial

  const ambient = new HemisphericLight('ambient', Vector3.Up(), scene)
  ambient.intensity = 0.65
  const key = new DirectionalLight('key', new Vector3(-0.5, -1, 0.4), scene)
  key.intensity = 0.8

  const camera = new ArcRotateCamera('battle-camera', -Math.PI / 4, Math.PI / 2 - 50 * Math.PI / 180, 11, new Vector3(0, 0.3, 0), scene)
  camera.lowerRadiusLimit = 6
  camera.upperRadiusLimit = 14
  const forward = camera.target.subtract(camera.position)
  forward.y = 0
  forward.normalize()
  const right = Vector3.Cross(forward, Vector3.Up()).normalize()

  let movement: MovementState = { x: 0, z: 0, yaw: 0, smoothedX: 0, smoothedY: 0 }
  let latestMotion: MotionInput = { x: 0, y: 0 }
  let lastMotionAt = 0
  let lastAAt = -Infinity
  let lastBAt = -Infinity
  let currentAttack: AttackState | null = null
  let inspecting = false
  let dragging: { pointerId: number; x: number; y: number } | null = null

  const pointerDown = (event: PointerEvent) => {
    if (!inspecting || dragging || (event.pointerType === 'mouse' && event.button !== 0)) return
    dragging = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    canvas.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: PointerEvent) => {
    if (!inspecting || !dragging || dragging.pointerId !== event.pointerId) return
    const dx = event.clientX - dragging.x
    const dy = event.clientY - dragging.y
    dragging.x = event.clientX
    dragging.y = event.clientY
    const rate = 2 * Math.PI / Math.max(canvas.clientWidth, 400)
    const yaw = Quaternion.RotationAxis(Vector3.Up(), dx * rate)
    const pitch = Quaternion.RotationAxis(Vector3.Right(), dy * rate)
    inspection.rotationQuaternion = yaw.multiply(pitch).multiply(inspection.rotationQuaternion!)
  }
  const pointerEnd = (event: PointerEvent) => {
    if (dragging?.pointerId !== event.pointerId) return
    dragging = null
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }
  const wheel = (event: WheelEvent) => {
    if (!inspecting) return
    event.preventDefault()
    camera.radius = Math.max(6, Math.min(14, camera.radius * Math.exp(event.deltaY * 0.001)))
  }
  canvas.addEventListener('pointerdown', pointerDown)
  canvas.addEventListener('pointermove', pointerMove)
  canvas.addEventListener('pointerup', pointerEnd)
  canvas.addEventListener('pointercancel', pointerEnd)
  canvas.addEventListener('wheel', wheel, { passive: false })
  const resizeObserver = new ResizeObserver(() => engine.resize())
  resizeObserver.observe(canvas)

  engine.runRenderLoop(() => {
    const now = performance.now()
    const seconds = Math.min(engine.getDeltaTime() / 1000, 0.05)
    if (!inspecting) {
      if (now - lastMotionAt > 250) {
        latestMotion = { x: 0, y: 0 }
        movement.smoothedX = 0
        movement.smoothedY = 0
      }
      movement = stepMovement(movement, latestMotion, seconds, right, forward)
      const distance = Math.hypot(movement.x, movement.z)
      if (distance > 5.4) {
        movement.x *= 5.4 / distance
        movement.z *= 5.4 / distance
      }
      actor.position.set(movement.x, 0, movement.z)
      actor.rotation.y = movement.yaw
    }
    lunge.position.z = attackOffset(currentAttack, now)
    if (currentAttack && attackOffset(currentAttack, now) === 0 && now - currentAttack.startedAt > 390) currentAttack = null
    camera.setTarget(Vector3.Lerp(camera.target, new Vector3(actor.position.x, 0.3, actor.position.z), Math.min(1, seconds * 5)), false, false, true)
    scene.render()
  })

  return {
    setMotion: (motion) => {
      if (inspecting) return
      latestMotion = motion
      lastMotionAt = performance.now()
    },
    stop: () => {
      latestMotion = { x: 0, y: 0 }
      movement.smoothedX = 0
      movement.smoothedY = 0
      currentAttack = null
      lunge.position.z = 0
    },
    attack: (button) => {
      if (inspecting || currentAttack) return false
      const now = performance.now()
      if (button === 'a') {
        if (now - lastAAt < 400) return false
        lastAAt = now
      } else {
        if (now - lastBAt < 3000) return false
        lastBAt = now
      }
      currentAttack = { button, startedAt: now }
      return true
    },
    setInspecting: (value) => {
      inspecting = value
      latestMotion = { x: 0, y: 0 }
      movement.smoothedX = 0
      movement.smoothedY = 0
      if (!value) {
        inspection.rotationQuaternion = Quaternion.Identity()
        camera.radius = 11
      }
    },
    dispose: () => {
      resizeObserver.disconnect()
      canvas.removeEventListener('pointerdown', pointerDown)
      canvas.removeEventListener('pointermove', pointerMove)
      canvas.removeEventListener('pointerup', pointerEnd)
      canvas.removeEventListener('pointercancel', pointerEnd)
      canvas.removeEventListener('wheel', wheel)
      scene.dispose()
      engine.dispose()
    },
  }
}
