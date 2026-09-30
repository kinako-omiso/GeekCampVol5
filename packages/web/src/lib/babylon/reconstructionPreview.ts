import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { Engine } from '@babylonjs/core/Engines/engine'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Scene } from '@babylonjs/core/scene'
import { getVolumeCentroid } from '../../features/analyze/reconstruction/centroid'
import type { ReconstructionResult } from '../../features/analyze/reconstruction/types'

export function mountReconstructionPreview(canvas: HTMLCanvasElement, reconstruction: ReconstructionResult, onFirstFrame?: () => void): () => void {
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
  material.sideOrientation = Material.ClockWiseSideOrientation
  mesh.material = material

  const centroid = getVolumeCentroid(reconstruction)
  const center = centroid ? new Vector3(centroid.x, centroid.y, centroid.z) : mesh.getBoundingInfo().boundingBox.centerWorld.clone()
  const pivot = new TransformNode('model-center-pivot', scene)
  pivot.position.copyFrom(center)
  pivot.rotationQuaternion = Quaternion.Identity()
  mesh.parent = pivot
  mesh.position.copyFrom(center.scale(-1))
  const camera = new ArcRotateCamera('preview-camera', Math.PI / 2.8, Math.PI / 2.7, 2.3, center, scene)

  const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene)
  ambient.intensity = 0.3
  const key = new DirectionalLight('key', new Vector3(-0.4, -0.7, -1), scene)
  key.intensity = 1.0
  const backFill = new DirectionalLight('back-fill', new Vector3(0.35, -0.6, 1), scene)
  backFill.intensity = 1.0

  let dragging: { pointerId: number; x: number; y: number } | null = null
  const onPointerDown = (event: PointerEvent) => {
    if (dragging || (event.pointerType === 'mouse' && event.button !== 0)) return
    dragging = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    canvas.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging || dragging.pointerId !== event.pointerId) return
    const dx = event.clientX - dragging.x
    const dy = event.clientY - dragging.y
    dragging.x = event.clientX
    dragging.y = event.clientY
    const radiansPerPixel = 2 * Math.PI / Math.max(400, canvas.clientWidth)
    const yaw = Quaternion.RotationAxis(Vector3.Up(), dx * radiansPerPixel)
    const pitch = Quaternion.RotationAxis(camera.getDirection(Vector3.Right()), dy * radiansPerPixel)
    pivot.rotationQuaternion = yaw.multiply(pitch).multiply(pivot.rotationQuaternion!)
  }
  const endDrag = (event: PointerEvent) => {
    if (dragging?.pointerId !== event.pointerId) return
    dragging = null
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }
  const onLostPointerCapture = () => { dragging = null }
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1)
    const scale = Math.max(0.5, Math.min(2.2, pivot.scaling.x * Math.exp(-pixels * 0.001)))
    pivot.scaling.setAll(scale)
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)
  canvas.addEventListener('lostpointercapture', onLostPointerCapture)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  const resizeObserver = new ResizeObserver(() => engine.resize())
  resizeObserver.observe(canvas)
  let firstFrame = true
  engine.runRenderLoop(() => {
    scene.render()
    if (firstFrame) { firstFrame = false; onFirstFrame?.() }
  })
  return () => {
    resizeObserver.disconnect()
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', endDrag)
    canvas.removeEventListener('pointercancel', endDrag)
    canvas.removeEventListener('lostpointercapture', onLostPointerCapture)
    canvas.removeEventListener('wheel', onWheel)
    scene.dispose()
    engine.dispose()
  }
}
