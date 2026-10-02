import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'
import '@babylonjs/core/Rendering/outlineRenderer'
import { colors } from '../../../../../../docs/design/tokens'
import { RING_RADIUS } from './ringExit'

/**
 * 浮島のアリーナ（見本：docs/design/screens/pc-06-battle.html）。
 * のれる範囲（有効半径）は草、外は雲。物理の床は RING_RADIUS の固定サイズのままで、
 * 見た目は場外判定と同じ有効半径の数値だけを参照して作る。
 */
export type ArenaState = {
  // いまの有効半径
  radius: number
  // 予告中なら縮小後の半径。予告していないときは radius と同じ
  nextRadius: number
}

export type Arena = {
  // 物理の床（PhysicsBody を付ける）
  ground: Mesh
  update: (state: ArenaState, timeMs: number) => void
}

const ISLAND_DEPTH = 1.1
const OUTLINE_WIDTH = 0.05
const ink = Color3.FromHexString(colors.ink)

/** 塗りだけの色（光の向きで色が変わらない平たい見た目）。 */
function flatMaterial(name: string, scene: Scene, color: string, alpha = 1) {
  const material = new StandardMaterial(name, scene)
  material.disableLighting = true
  material.emissiveColor = Color3.FromHexString(color)
  material.alpha = alpha
  return material
}

/** テクスチャの色をそのまま出す平たい見た目（emissiveColor はテクスチャに足されるので黒にする）。 */
function flatTextureMaterial(name: string, scene: Scene, texture: DynamicTexture) {
  const material = flatMaterial(name, scene, '#000000')
  material.emissiveTexture = texture
  if (texture.hasAlpha) {
    material.diffuseTexture = texture
    material.useAlphaFromDiffuseTexture = true
  }
  return material
}

function outline(mesh: Mesh, width = OUTLINE_WIDTH) {
  mesh.renderOutline = true
  mesh.outlineColor = ink
  mesh.outlineWidth = width
}

/** 床に寝かせた輪（内側 inner〜外側 outer）。UV はワールドの x/z をそのまま使う。 */
function createAnnulus(name: string, scene: Scene, inner: number, outer: number, y: number) {
  const segments = 128
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    const cos = Math.cos(angle), sin = Math.sin(angle)
    positions.push(cos * inner, y, sin * inner, cos * outer, y, sin * outer)
    uvs.push(cos * inner, sin * inner, cos * outer, sin * outer)
    if (index < segments) {
      const a = index * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const data = new VertexData()
  data.positions = positions
  data.indices = indices
  data.uvs = uvs
  data.normals = []
  VertexData.ComputeNormals(positions, indices, data.normals)
  const mesh = new Mesh(name, scene)
  data.applyToMesh(mesh)
  mesh.isPickable = false
  return mesh
}

/** 草の島の上面。プレイヤーが位置を測りやすいように、見本と同じ同心円のしまと小さな花を描く。 */
function grassTexture(scene: Scene) {
  const size = 1024
  const texture = new DynamicTexture('arena-grass-texture', size, scene, true)
  const context = texture.getContext()
  const center = size / 2
  context.fillStyle = colors.grass
  context.fillRect(0, 0, size, size)
  context.strokeStyle = colors.grassStripe
  context.lineWidth = size * 0.021
  for (const ratio of [330 / 430, 220 / 430, 110 / 430]) {
    context.beginPath()
    context.arc(center, center, center * ratio, 0, Math.PI * 2)
    context.stroke()
  }
  context.fillStyle = '#ffffff'
  context.strokeStyle = colors.ink
  context.lineWidth = 3
  for (const [x, y] of [[0.36, 0.3], [0.7, 0.32], [0.62, 0.78], [0.28, 0.66], [0.8, 0.58]]) {
    context.beginPath()
    context.arc(x * size, y * size, 7, 0, Math.PI * 2)
    context.fill()
    context.stroke()
  }
  texture.update()
  return texture
}

/** 縮小予告のしましま（赤）。UV がワールド座標なので、しまの太さはどの半径でも同じ。 */
function hatchTexture(scene: Scene) {
  const size = 64
  const texture = new DynamicTexture('arena-hatch-texture', size, scene, true)
  texture.hasAlpha = true
  const context = texture.getContext()
  context.clearRect(0, 0, size, size)
  // tokens.css の --ss-danger（透明度 .34）より少し濃くして、草の上でも見えるようにする
  context.fillStyle = 'rgba(232, 40, 79, 0.5)'
  // 斜めのしまを1タイルぶん描く（端をまたぐぶんも描いてつなげる）
  for (const offset of [-size, 0, size]) {
    context.beginPath()
    context.moveTo(offset, 0)
    context.lineTo(offset + size * 0.43, 0)
    context.lineTo(offset + size * 0.43 + size, size)
    context.lineTo(offset + size, size)
    context.closePath()
    context.fill()
  }
  texture.update()
  texture.wrapU = Texture.WRAP_ADDRESSMODE
  texture.wrapV = Texture.WRAP_ADDRESSMODE
  texture.uScale = texture.vScale = 1 / 1.1
  return texture
}

/** 真ん中を指す白い矢印（assets/move-in.svg と同じ形）。テクスチャの +u 方向を指す。 */
function moveInTexture(scene: Scene) {
  const size = 128
  const texture = new DynamicTexture('arena-move-in-texture', size, scene, true)
  texture.hasAlpha = true
  // 線の端と角を丸めるため、ブラウザの CanvasRenderingContext2D として扱う
  const context = texture.getContext() as unknown as CanvasRenderingContext2D
  context.clearRect(0, 0, size, size)
  context.scale(size / 44, size / 44)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const [color, width] of [[colors.ink, 13], ['#ffffff', 6]] as const) {
    context.strokeStyle = color
    context.lineWidth = width
    context.beginPath()
    context.moveTo(6, 9); context.lineTo(17, 22); context.lineTo(6, 35)
    context.moveTo(22, 9); context.lineTo(33, 22); context.lineTo(22, 35)
    context.stroke()
  }
  texture.update()
  return texture
}

/** もこもこの雲（球を並べて1つのメッシュにまとめる）。 */
function createCloudPuffs(name: string, scene: Scene, points: { x: number; z: number; size: number }[], y: number, material: StandardMaterial) {
  const spheres = points.map(({ x, z, size }, index) => {
    const sphere = MeshBuilder.CreateSphere(`${name}-${index}`, { diameter: size, segments: 8 }, scene)
    sphere.scaling.y = 0.55
    sphere.position.set(x, y, z)
    return sphere
  })
  const merged = Mesh.MergeMeshes(spheres, true, true)!
  merged.name = name
  merged.material = material
  merged.isPickable = false
  outline(merged, 0.04)
  return merged
}

export function createArena(scene: Scene): Arena {
  // 上面の草（物理の床と同じ厚み・半径）
  const ground = MeshBuilder.CreateCylinder('arena', { diameter: RING_RADIUS * 2, height: 0.12, tessellation: 96 }, scene)
  ground.position.y = -0.06
  ground.material = flatMaterial('arena-grass', scene, colors.grass)
  // 上面のふちの線。草の円柱に outline を付けると上面より上へ押し出され、床に置いたリングや影を隠すため、輪で描く
  const edge = MeshBuilder.CreateTorus('arena-edge', { diameter: RING_RADIUS * 2, thickness: 0.1, tessellation: 128 }, scene)
  edge.position.y = -0.02
  edge.material = flatMaterial('arena-edge-material', scene, colors.ink)
  edge.isPickable = false

  const top = MeshBuilder.CreateDisc('arena-top', { radius: RING_RADIUS, tessellation: 96 }, scene)
  top.rotation.x = Math.PI / 2
  top.position.y = 0.002
  top.isPickable = false
  top.material = flatTextureMaterial('arena-top-material', scene, grassTexture(scene))

  // 岩の側面（島の厚み）。ふちどりで見本の輪郭線を出す
  const rock = MeshBuilder.CreateCylinder('arena-rock', {
    diameterTop: RING_RADIUS * 2, diameterBottom: RING_RADIUS * 1.86, height: ISLAND_DEPTH, tessellation: 96,
  }, scene)
  rock.position.y = -0.12 - ISLAND_DEPTH / 2
  const rockMaterial = new StandardMaterial('arena-rock-material', scene)
  rockMaterial.diffuseColor = Color3.FromHexString(colors.rock)
  rockMaterial.emissiveColor = Color3.FromHexString(colors.rockDark).scale(0.6)
  rockMaterial.specularColor = Color3.Black()
  rock.material = rockMaterial
  rock.isPickable = false
  outline(rock)

  const cloud = flatMaterial('arena-cloud', scene, colors.cloud)
  // 床に寝かせた輪は裏表を気にせず描く
  cloud.backFaceCulling = false

  // 島のまわりの雲（飾り）。見本と同じく、ゆっくり ふくらむ
  const decorations = Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2 + Math.PI / 8
    const radius = RING_RADIUS + 0.9
    const cx = Math.cos(angle) * radius, cz = Math.sin(angle) * radius
    const tangent = { x: -Math.sin(angle), z: Math.cos(angle) }
    const puffs = createCloudPuffs(`arena-cloud-deco-${index}`, scene, [-0.7, 0, 0.7].map((t, i) => ({
      x: tangent.x * t, z: tangent.z * t, size: i === 1 ? 1.5 : 1.1,
    })), 0, cloud)
    puffs.position.set(cx, -0.45, cz)
    return puffs
  })

  // 有効半径の外を覆う雲。縮んだときだけ作り直す
  let coverRadius = RING_RADIUS
  let cover: Mesh[] = []
  const buildCover = (radius: number) => {
    for (const mesh of cover) mesh.dispose()
    cover = []
    coverRadius = radius
    if (radius >= RING_RADIUS) return
    const floor = createAnnulus('arena-cloud-cover', scene, radius + 0.15, RING_RADIUS + 0.35, 0.06)
    floor.material = cloud
    const count = Math.max(12, Math.round((Math.PI * 2 * radius) / 0.8))
    const edge = createCloudPuffs('arena-cloud-edge', scene, Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2
      return { x: Math.cos(angle) * (radius + 0.3), z: Math.sin(angle) * (radius + 0.3), size: index % 2 ? 0.8 : 1 }
    }), 0.1, cloud)
    cover = [floor, edge]
  }

  // 縮小予告：草のふちの赤いしましま（点滅）・縮小後の境界の白い点線・真ん中を指す矢印
  const hatchMaterial = flatTextureMaterial('arena-hatch-material', scene, hatchTexture(scene))
  hatchMaterial.backFaceCulling = false
  let hatch: Mesh | null = null
  let dashes: Mesh | null = null
  let dashStep = 0
  const dashMaterial = flatMaterial('arena-dash-material', scene, '#ffffff')
  const arrowMaterial = flatTextureMaterial('arena-move-in-material', scene, moveInTexture(scene))
  // カメラは方位角 -45° 固定なので、画面の左右上下にあたる 45°+90°×k に置く
  const arrowAngles = [0, 1, 2, 3].map((k) => Math.PI / 4 + (k * Math.PI) / 2)
  const arrows = arrowAngles.map((angle, index) => {
    const arrow = MeshBuilder.CreateGround(`arena-move-in-${index}`, { width: 0.9, height: 0.9 }, scene)
    arrow.material = arrowMaterial
    // テクスチャの +u（矢印の向き）＝ローカル +x を、中心へ向かう方向 -(cos, sin) にそろえる
    arrow.rotation.y = Math.PI - angle
    arrow.isPickable = false
    arrow.setEnabled(false)
    return arrow
  })
  let warningKey = ''
  const buildWarning = (radius: number, nextRadius: number) => {
    hatch?.dispose(); dashes?.dispose()
    hatch = dashes = null
    warningKey = `${radius}:${nextRadius}`
    for (const arrow of arrows) arrow.setEnabled(nextRadius < radius)
    if (nextRadius >= radius) return
    hatch = createAnnulus('arena-hatch', scene, nextRadius, radius, 0.03)
    hatch.material = hatchMaterial
    const count = Math.round((Math.PI * 2 * nextRadius) / 0.45)
    dashStep = (Math.PI * 2) / count
    const parts = Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2
      const dash = MeshBuilder.CreateBox(`arena-dash-${index}`, { width: 0.09, height: 0.02, depth: 0.28 }, scene)
      dash.position.set(Math.cos(angle) * nextRadius, 0.045, Math.sin(angle) * nextRadius)
      dash.rotation.y = -angle
      return dash
    })
    dashes = Mesh.MergeMeshes(parts, true, true)!
    dashes.material = dashMaterial
    dashes.isPickable = false
  }

  return {
    ground,
    update: ({ radius, nextRadius }, timeMs) => {
      if (radius !== coverRadius) buildCover(radius)
      if (`${radius}:${nextRadius}` !== warningKey) buildWarning(radius, nextRadius)
      for (const [index, puffs] of decorations.entries()) {
        const scale = 1 + 0.08 * Math.sin(timeMs / 190 + index * 1.7)
        puffs.scaling.set(scale, scale, scale)
      }
      if (!hatch) return
      // 見本の点滅（0.6秒周期で 0.35〜1）・点線の行進・矢印が内側へ動く
      hatchMaterial.alpha = 0.675 + 0.325 * Math.cos((timeMs / 600) * Math.PI * 2)
      // 1秒で点線2つぶん回す（見本の stroke-dashoffset の行進）
      dashes!.rotation.y = -((timeMs / 1000) % 1) * dashStep * 2
      const inward = 0.15 * Math.sin((timeMs / 900) * Math.PI * 2)
      for (const [index, arrow] of arrows.entries()) {
        const angle = arrowAngles[index]
        const distance = nextRadius + 0.55 - inward
        arrow.position = new Vector3(Math.cos(angle) * distance, 0.05, Math.sin(angle) * distance)
      }
    },
  }
}
