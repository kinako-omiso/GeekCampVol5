import type { FighterStats } from '@gikcamp/protocol'
import { ATTACKS, BattleRules, type BattleHit, type BattleSnapshot } from './battleRules'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import '@babylonjs/core/Rendering/outlineRenderer'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { PhysicsEventType, PhysicsMotionType, PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin'
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate'
import { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody'
import { PhysicsShapeContainer, PhysicsShapeCylinder } from '@babylonjs/core/Physics/v2/physicsShape'
import { Scene } from '@babylonjs/core/scene'
import { colors, players, type PlayerId } from '../../../../../../docs/design/tokens'
import { getVolumeCentroid } from '../../analyze/reconstruction/centroid'
import { reconstructQuickScan } from '../../analyze/reconstruction/quickScan'
import { createWebGL2Engine } from '../../../lib/babylon/engine'
import { enableHavok } from '../../../lib/babylon/havok'
import { calculateKnockbackImpulse, TEST_ATTACK_MULTIPLIERS, TEST_ATTACK_VALUE } from './knockback'
import { stepMovement, type MotionInput, type MovementState } from './movement'
import { hasJustLeftRing, RING_RADIUS } from './ringExit'
import { createArena } from './arena'
import { createSampleMask } from './sampleMask'
import { prepareFighterModel, type BattleFighterModel, type PreparedFighter } from './fighterPlacement'
import { createFighterMesh } from './fighterMesh'

export type PhysicsBattleOptions = {
  fighters?: Partial<Record<PlayerId, BattleFighterModel>>
  production?: { stats: Record<PlayerId, FighterStats>; onSnapshot: (snapshot: BattleSnapshot) => void }
}

const FIGHTER = 1
const FLOOR_REGION = 2
const MAX_ACCELERATION = 12
const TEST_IMPULSE = 6.5
const CONTACT_IMPULSE = 2
const EXIT_IMPULSE = 1.2
const ATTACK_FORWARD_MS = 100
const ATTACK_MIN_INTERVAL_MS = 400
const ATTACK_RETURN_MS = 200
const ATTACKER_DRIVE_LOCK_MS = 180
const DEFENDER_DRIVE_LOCK_MS = 250
/**
 * 対戦でのコマの倍率。生成モデルはサンプルと同じ高さ1にそろえてあり、そのままでは島（半径6）に対して小さすぎるため、
 * 見本（docs/design/screens/pc-06-battle.html）の「コマの幅が島の直径の約1/4」に合わせて大きくする。
 */
const BATTLE_FIGHTER_SCALE = 3
// 横に長いモデルでも開始時に重ならないよう、足元の半径（足元リングの半径）をこの値までに抑える。両者の開始距離は 6.0
const MAX_FOOTPRINT_RADIUS = 1.8
// 足元リングをモデルの輪郭より少し外に出す
const FOOTPRINT_MARGIN = 0.15
// 離れたと見なして接触の通知を再び有効にする、両者の中心の距離
const CONTACT_REARM_DISTANCE = 2 * MAX_FOOTPRINT_RADIUS + 0.4
// カメラ。見本の楕円（横:縦 ≒ 1.6:1）に近い仰角39°で、島を画面の中央下に置く
const CAMERA_ELEVATION = 39 * Math.PI / 180
const CAMERA_RADIUS = 15
const CAMERA_TARGET_HEIGHT = 1
// 注視点を画面の奥へずらす量（HUD の下に島が来るようにする）
const CAMERA_TARGET_SHIFT = 1.2
const CAMERA_ALPHA = -Math.PI / 4

type TestAttack = {
  button?: 'a' | 'b'
  expiresAt: number
  consumed: boolean
  origin: Vector3
  retreat: { startedAt: number; from: Vector3; reachedTarget: boolean } | null
}

type Fighter = {
  mesh: Mesh
  ringMaterial: StandardMaterial
  ringColor: Color3
  shadow: Mesh
  aggregate: PhysicsAggregate
  movement: MovementState
  input: MotionInput
  inputAt: number
  out: boolean
  attack: TestAttack | null
  nextAttackAt: number
  driveLockUntil: number
  attackMultiplier: number
  stats?: FighterStats
  windup: { endsAt: number; direction: Vector3 } | null
  flashUntil: number
}

export type PhysicsBattleEvent =
  | { type: 'contact' }
  | { type: 'hit'; attacker: PlayerId; target: PlayerId; impulse: number; button?: 'a' | 'b' }
  | { type: 'out'; player: PlayerId }
export type PhysicsBattle = {
  setInput: (player: PlayerId, input: MotionInput) => void
  triggerTestAttack: (player: PlayerId) => boolean
  triggerAttack: (player: PlayerId, button: 'a' | 'b') => boolean
  setPaused: (paused: boolean) => void
  dispose: () => void
}

function scalePoints(points: Float32Array, scale: number) {
  return points.map((value) => value * scale)
}

/** 足元の中心からいちばん遠い頂点までの水平距離。 */
function footprintRadius(positions: Float32Array, footX: number, footZ: number) {
  let radius = 0
  for (let index = 0; index < positions.length; index += 3) {
    radius = Math.max(radius, Math.hypot(positions[index] - footX, positions[index + 2] - footZ))
  }
  return radius
}

/** 表示・衝突・重心を対戦の大きさへ一様にそろえる。足元の中心（生成モデルは原点、サンプルは重心）を基準に倍率を決める。 */
function scaleForBattle(sample: ReturnType<typeof reconstructQuickScan>, prepared?: PreparedFighter) {
  const source = prepared?.reconstruction ?? sample
  const centroid = prepared ? undefined : getVolumeCentroid(source)
  const radius = footprintRadius(source.positions, centroid?.x ?? 0, centroid?.z ?? 0)
  const scale = radius > 0 ? Math.min(BATTLE_FIGHTER_SCALE, MAX_FOOTPRINT_RADIUS / radius) : BATTLE_FIGHTER_SCALE
  return {
    sample: { ...sample, positions: scalePoints(sample.positions, scale) },
    prepared: prepared && {
      reconstruction: { ...prepared.reconstruction, positions: scalePoints(prepared.reconstruction.positions, scale) },
      collisionPositions: scalePoints(prepared.collisionPositions, scale),
      centerOfMass: prepared.centerOfMass.map((value) => value * scale) as PreparedFighter['centerOfMass'],
    },
    footprint: radius * scale + FOOTPRINT_MARGIN,
  }
}

/** 足元の前側に付ける向きの三角（ローカル +z が前）。 */
function createPointer(name: string, scene: Scene, footprint: number, y: number) {
  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = [0, y, footprint + 0.5, -0.3, y, footprint + 0.08, 0.3, y, footprint + 0.08]
  data.indices = [0, 1, 2]
  data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0]
  data.applyToMesh(mesh)
  return mesh
}

function createFighter(scene: Scene, player: PlayerId, rawSample: ReturnType<typeof reconstructQuickScan>, model?: BattleFighterModel, stats?: FighterStats): Fighter {
  const scaled = scaleForBattle(rawSample, model ? prepareFighterModel(model) : undefined)
  const prepared = scaled.prepared
  const reconstruction = prepared?.reconstruction ?? scaled.sample
  const center = prepared ? { x: prepared.centerOfMass[0], y: prepared.centerOfMass[1], z: prepared.centerOfMass[2] } : getVolumeCentroid(reconstruction)
  const centered = new Float32Array(reconstruction.positions.length)
  let bottom = Infinity
  for (let index = 0; index < centered.length; index += 3) {
    centered[index] = reconstruction.positions[index] - (center?.x ?? 0)
    centered[index + 1] = reconstruction.positions[index + 1] - (center?.y ?? 0)
    centered[index + 2] = reconstruction.positions[index + 2] - (center?.z ?? 0)
    bottom = Math.min(bottom, centered[index + 1])
  }

  const mesh = createFighterMesh(scene, player + '-fighter', {
    positions: centered, indices: reconstruction.indices, normals: reconstruction.normals,
  })
  const yaw = player === 'p1' ? Math.PI / 2 : -Math.PI / 2
  mesh.position.set(player === 'p1' ? -3 : 3, -bottom + 0.04, 0)
  if (prepared && center) {
    // 剛体原点は生成時の重心。足元基準の開始地点は左右3.0のままにする。
    mesh.position.addInPlace(new Vector3(
      Math.cos(yaw) * center.x + Math.sin(yaw) * center.z, 0,
      -Math.sin(yaw) * center.x + Math.cos(yaw) * center.z,
    ))
    bottom = -center.y
    mesh.position.y = -bottom + 0.04
  }
  mesh.rotationQuaternion = Quaternion.RotationYawPitchRoll(yaw, 0, 0)

  // 足元のプレイヤーカラーのリング（見本：うすい塗り＋太い輪＋前側の三角）
  const ringColor = Color3.FromHexString(players[player].main)
  const ringMaterial = new StandardMaterial(player + '-ring-material', scene)
  ringMaterial.disableLighting = true
  ringMaterial.emissiveColor = ringColor.clone()
  ringMaterial.backFaceCulling = false
  const fillMaterial = new StandardMaterial(player + '-ring-fill-material', scene)
  fillMaterial.disableLighting = true
  fillMaterial.emissiveColor = ringColor.clone()
  fillMaterial.alpha = 0.25
  const foot = new Mesh(player + '-foot', scene)
  foot.parent = mesh
  foot.position.y = bottom + 0.02
  if (prepared && center) { foot.position.x = -center.x; foot.position.z = -center.z }
  const fill = MeshBuilder.CreateDisc(player + '-ring-fill', { radius: scaled.footprint, tessellation: 64 }, scene)
  fill.rotation.x = Math.PI / 2
  fill.material = fillMaterial
  const ring = MeshBuilder.CreateTorus(player + '-ring', { diameter: scaled.footprint * 2, thickness: 0.2, tessellation: 64 }, scene)
  ring.scaling.y = 0.3
  ring.material = ringMaterial
  const pointer = createPointer(player + '-front', scene, scaled.footprint, 0.02)
  pointer.material = ringMaterial
  pointer.renderOutline = true
  pointer.outlineColor = Color3.FromHexString(colors.ink)
  pointer.outlineWidth = 0.04
  for (const part of [fill, ring, pointer]) { part.parent = foot; part.isPickable = false }

  // 床に落ちる影。コマが傾いても床に貼りつくよう、コマの子にはしない
  const shadow = MeshBuilder.CreateDisc(player + '-shadow', { radius: scaled.footprint * 0.8, tessellation: 48 }, scene)
  shadow.rotation.x = Math.PI / 2
  const shadowMaterial = new StandardMaterial(player + '-shadow-material', scene)
  shadowMaterial.disableLighting = true
  shadowMaterial.emissiveColor = Color3.FromHexString(colors.ink)
  shadowMaterial.alpha = 0.28
  shadow.material = shadowMaterial
  shadow.isPickable = false

  // 凸包は Havok の衝突用形状。能力値を出す C++ の形状解析には使わない。
  let collisionMesh: Mesh | undefined
  if (prepared && center) {
    collisionMesh = new Mesh(player + '-clipped-collision', scene)
    const collisionData = new VertexData()
    collisionData.positions = prepared.collisionPositions.map((value, index) =>
      value - [center.x, center.y, center.z][index % 3])
    collisionData.applyToMesh(collisionMesh)
    collisionMesh.setEnabled(false)
  }
  const aggregate = new PhysicsAggregate(mesh, PhysicsShapeType.CONVEX_HULL, {
    mass: 1,
    friction: 0.65,
    restitution: 0.05,
    ...(collisionMesh ? { mesh: collisionMesh, includeChildMeshes: false } : {}),
  }, scene)
  // Havokは頂点をコピーするため、衝突用の非表示Meshは以降不要。
  collisionMesh?.dispose()
  aggregate.shape.filterMembershipMask = FIGHTER
  aggregate.shape.filterCollideMask = FIGHTER | FLOOR_REGION
  aggregate.body.setMassProperties({
    mass: 1,
    inertia: new Vector3(0, 0.2, 0),
    inertiaOrientation: Quaternion.Identity(),
    // 切断した凸包の重心へ変わらないよう、生成時の重心を明示する。
    ...(prepared ? { centerOfMass: Vector3.Zero() } : {}),
  })
  aggregate.body.setLinearDamping(0.35)
  aggregate.body.setAngularDamping(4)

  return {
    mesh,
    ringMaterial,
    ringColor,
    shadow,
    aggregate,
    movement: { x: mesh.position.x, z: mesh.position.z, yaw, smoothedX: 0, smoothedY: 0 },
    input: { x: 0, y: 0 },
    inputAt: 0,
    out: false,
    attack: null,
    nextAttackAt: 0,
    driveLockUntil: 0,
    attackMultiplier: stats?.attack ?? TEST_ATTACK_MULTIPLIERS[player],
    stats, windup: null, flashUntil: 0,
  }
}

function drive(fighter: Fighter, seconds: number, now: number) {
  if (fighter.stats && performance.now() - fighter.inputAt > 250) fighter.input = { x: 0, y: 0 }
  if (fighter.out || fighter.windup || (fighter.stats && fighter.attack) || fighter.attack?.retreat || now < fighter.driveLockUntil) return
  const body = fighter.aggregate.body
  const position = fighter.mesh.position
  const previousYaw = fighter.movement.yaw
  const next = stepMovement(
    { ...fighter.movement, x: position.x, z: position.z },
    fighter.input,
    seconds,
    fighter.stats ? { x: Math.SQRT1_2, z: Math.SQRT1_2 } : { x: 1, z: 0 },
    fighter.stats ? { x: -Math.SQRT1_2, z: Math.SQRT1_2 } : { x: 0, z: 1 },
    fighter.stats,
  )
  const velocity = body.getLinearVelocity()
  const desiredX = (next.x - position.x) / seconds
  const desiredZ = (next.z - position.z) / seconds
  let accelerationX = (desiredX - velocity.x) / seconds
  let accelerationZ = (desiredZ - velocity.z) / seconds
  const acceleration = Math.hypot(accelerationX, accelerationZ)
  if (acceleration > MAX_ACCELERATION) {
    accelerationX *= MAX_ACCELERATION / acceleration
    accelerationZ *= MAX_ACCELERATION / acceleration
  }
  body.applyForce(new Vector3(accelerationX, 0, accelerationZ), body.getObjectCenterWorld())
  body.setAngularVelocity(new Vector3(0, (next.yaw - previousYaw) / seconds, 0))
  fighter.movement = next
}

function updateAttackReturn(fighter: Fighter, now: number) {
  const attack = fighter.attack
  if (!attack || fighter.out) return
  const body = fighter.aggregate.body
  if (!attack.retreat && (attack.consumed || now >= attack.expiresAt)) {
    attack.retreat = { startedAt: now, from: fighter.mesh.position.clone(), reachedTarget: false }
    body.setLinearVelocity(Vector3.Zero())
    body.setAngularVelocity(Vector3.Zero())
    // 復帰中だけ剛体の位置を制御し、終了後は動的剛体へ戻す。
    body.setMotionType(PhysicsMotionType.ANIMATED)
  }
  if (!attack.retreat) return
  const progress = Math.min(1, (now - attack.retreat.startedAt) / ATTACK_RETURN_MS)
  const blend = progress * progress * (3 - 2 * progress)
  const target = Vector3.Lerp(attack.retreat.from, attack.origin, blend)
  body.setTargetTransform(target, fighter.mesh.rotationQuaternion ?? Quaternion.Identity())
  attack.retreat.reachedTarget = progress >= 1
}

function finishAttackReturn(fighter: Fighter) {
  const attack = fighter.attack
  if (!attack?.retreat?.reachedTarget || fighter.out) return
  const body = fighter.aggregate.body
  body.setMotionType(PhysicsMotionType.DYNAMIC)
  body.setLinearVelocity(Vector3.Zero())
  body.setAngularVelocity(Vector3.Zero())
  fighter.movement = {
    ...fighter.movement,
    x: fighter.mesh.position.x,
    z: fighter.mesh.position.z,
    smoothedX: 0,
    smoothedY: 0,
  }
  fighter.attack = null
}

/** #6 / #49 用の2体物理検証。React側は入力とイベント表示だけを担当する。 */
export async function mountPhysicsBattle(
  canvas: HTMLCanvasElement,
  onEvent: (event: PhysicsBattleEvent) => void,
  signal?: AbortSignal,
  options: PhysicsBattleOptions = {},
): Promise<PhysicsBattle> {
  const engine = createWebGL2Engine(canvas)
  const scene = new Scene(engine)
  let resizeObserver: ResizeObserver | undefined
  let groundBody: PhysicsBody | undefined
  let floorShape: PhysicsShapeContainer | undefined
  let floorRegion: PhysicsShapeCylinder | undefined
  let fighters: Record<PlayerId, Fighter> | undefined
  let disposed = false
  let paused = !!options.production
  let simulationMs = 0
  let hitStopUntil = 0
  const rules = options.production ? new BattleRules(options.production.stats) : null
  const pendingHits: BattleHit[] = []
  let lastSnapshotAt = -Infinity
  const launch = (fighter: Fighter, button: 'a' | 'b', now: number) => {
    fighter.windup = null
    fighter.attack = { button, expiresAt: now + 150, consumed: false, origin: fighter.mesh.position.clone(), retreat: null }
    const direction = new Vector3(Math.sin(fighter.movement.yaw), 0, Math.cos(fighter.movement.yaw))
    const velocity = fighter.aggregate.body.getLinearVelocity()
    const speed = ATTACKS[button].reach * (fighter.stats?.reach ?? 1) / 0.15
    fighter.aggregate.body.setLinearVelocity(new Vector3(direction.x * speed, velocity.y, direction.z * speed))
  }
  const updateProductionAttack = (fighter: Fighter, now: number) => {
    if (fighter.windup && now >= fighter.windup.endsAt) launch(fighter, 'b', now)
    if (fighter.attack && (fighter.attack.consumed || now >= fighter.attack.expiresAt)) {
      const direction = new Vector3(Math.sin(fighter.movement.yaw), 0, Math.cos(fighter.movement.yaw))
      const velocity = fighter.aggregate.body.getLinearVelocity()
      const forwardSpeed = Math.max(0, Vector3.Dot(velocity, direction))
      fighter.aggregate.body.setLinearVelocity(velocity.subtract(direction.scale(forwardSpeed)))
      fighter.attack = null
    }
    const material = fighter.mesh.material as StandardMaterial
    material.emissiveColor = now < fighter.flashUntil ? Color3.White() : Color3.Black()
    fighter.ringMaterial.emissiveColor = fighter.windup ? Color3.White() : fighter.ringColor
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    engine.stopRenderLoop()
    resizeObserver?.disconnect()
    fighters?.p1.aggregate.dispose()
    fighters?.p2.aggregate.dispose()
    groundBody?.dispose()
    floorShape?.dispose()
    floorRegion?.dispose()
    scene.dispose()
    engine.dispose()
  }

  try {
    await enableHavok(scene, !!options.production)
    if (signal?.aborted) throw new DOMException('中断しました。', 'AbortError')

    // 空・遠くの山・雲海は canvas の後ろの 2D（ArenaBackdrop）で描く。本番以外（検証ページ）は空の色で塗る
    scene.clearColor = options.production ? new Color4(0, 0, 0, 0) : Color4.FromHexString(colors.sky + 'ff')
    const arena = createArena(scene)
    const ground = arena.ground

    floorRegion = new PhysicsShapeCylinder(
      new Vector3(0, -0.06, 0),
      new Vector3(0, 0.06, 0),
      RING_RADIUS,
      scene,
    )
    floorRegion.filterMembershipMask = FLOOR_REGION
    floorRegion.filterCollideMask = FIGHTER
    floorRegion.material = { friction: 0.85, restitution: 0 }
    floorShape = new PhysicsShapeContainer(scene)
    floorShape.addChild(floorRegion)
    floorShape.filterMembershipMask = FLOOR_REGION
    floorShape.filterCollideMask = FIGHTER
    groundBody = new PhysicsBody(ground, PhysicsMotionType.STATIC, false, scene)
    groundBody.shape = floorShape

    const reconstruction = reconstructQuickScan(createSampleMask())
    fighters = {
      p1: createFighter(scene, 'p1', reconstruction, options.fighters?.p1, options.production?.stats.p1),
      p2: createFighter(scene, 'p2', reconstruction, options.fighters?.p2, options.production?.stats.p2),
    }
    const activeFighters = fighters
    const firstBody = activeFighters.p1.aggregate.body
    const secondBody = activeFighters.p2.aggregate.body
    let contactArmed = true
    firstBody.setCollisionCallbackEnabled(true)
    firstBody.getCollisionObservable().add((event) => {
      if (disposed || activeFighters.p1.out || activeFighters.p2.out || event.collidedAgainst !== secondBody ||
          (event.type !== PhysicsEventType.COLLISION_STARTED && event.type !== PhysicsEventType.COLLISION_CONTINUED)) return
      const p1 = firstBody.getObjectCenterWorld()
      const p2 = secondBody.getObjectCenterWorld()
      const direction = p2.subtract(p1)
      direction.y = 0
      if (direction.lengthSquared() < 1e-8) {
        direction.set(Math.sin(activeFighters.p1.movement.yaw), 0, Math.cos(activeFighters.p1.movement.yaw))
      }
      direction.normalize()
      const now = rules ? simulationMs : performance.now()
      const hits = (['p1', 'p2'] as const).filter((player) => {
        const fighter = activeFighters[player]
        const attack = fighter.attack
        if (!attack || attack.consumed || now >= attack.expiresAt) return false
        const towardTarget = player === 'p1' ? direction : direction.scale(-1)
        const forward = new Vector3(Math.sin(fighter.movement.yaw), 0, Math.cos(fighter.movement.yaw))
        return Vector3.Dot(forward, towardTarget) > 0
      })

      if (event.type === PhysicsEventType.COLLISION_STARTED && contactArmed) {
        contactArmed = false
        onEvent({ type: 'contact' })
        firstBody.applyImpulse(direction.scale(-CONTACT_IMPULSE), p1)
        secondBody.applyImpulse(direction.scale(CONTACT_IMPULSE), p2)
      }

      // 双方の命中を先に確定し、片方への反動がもう片方の判定に影響しないようにする。
      for (const player of hits) {
        const fighter = activeFighters[player]
        fighter.attack!.consumed = true
        const body = fighter.aggregate.body
        const forward = new Vector3(Math.sin(fighter.movement.yaw), 0, Math.cos(fighter.movement.yaw))
        const velocity = body.getLinearVelocity()
        const forwardSpeed = Math.max(0, Vector3.Dot(velocity, forward))
        if (forwardSpeed > 0) body.setLinearVelocity(velocity.subtract(forward.scale(forwardSpeed)))
      }
      for (const player of hits) {
        const target = player === 'p1' ? 'p2' : 'p1'
        const attacker = activeFighters[player]
        const defender = activeFighters[target]
        const targetBody = defender.aggregate.body
        const targetCenter = targetBody.getObjectCenterWorld()
        const outward = player === 'p1' ? direction : direction.scale(-1)
        const impulse = calculateKnockbackImpulse({ attackValue: fighterAttackValue(attacker.attack?.button), attackMultiplier: attacker.attackMultiplier })
        targetBody.applyImpulse(outward.scale(impulse), targetCenter)
        attacker.driveLockUntil = Math.max(attacker.driveLockUntil, now + ATTACKER_DRIVE_LOCK_MS)
        defender.driveLockUntil = Math.max(defender.driveLockUntil, now + DEFENDER_DRIVE_LOCK_MS)
        attacker.movement.smoothedX = attacker.movement.smoothedY = 0
        defender.movement.smoothedX = defender.movement.smoothedY = 0
        const button = attacker.attack?.button
        if (rules && button) {
          pendingHits.push({ attacker: player, target, button })
          defender.flashUntil = now + 100
          hitStopUntil = performance.now() + 50
        }
        onEvent({ type: 'hit', attacker: player, target, impulse, button })
      }
    })

    const ambient = new HemisphericLight('ambient', Vector3.Up(), scene)
    ambient.intensity = 0.75
    const key = new DirectionalLight('key', new Vector3(-0.5, -1, 0.4), scene)
    key.intensity = 0.7
    // 注視点を画面の奥（カメラから離れる水平方向）へずらす
    const targetShift = new Vector3(-Math.cos(CAMERA_ALPHA), 0, -Math.sin(CAMERA_ALPHA)).scale(CAMERA_TARGET_SHIFT)
    const camera = new ArcRotateCamera(
      'battle-camera', CAMERA_ALPHA, Math.PI / 2 - CAMERA_ELEVATION,
      CAMERA_RADIUS, new Vector3(0, CAMERA_TARGET_HEIGHT, 0).add(targetShift), scene,
    )
    camera.lowerRadiusLimit = CAMERA_RADIUS
    camera.upperRadiusLimit = CAMERA_RADIUS * 1.3
    const arenaState = () => {
      const snapshot = rules?.snapshot()
      return { radius: snapshot?.radius ?? RING_RADIUS, nextRadius: snapshot?.nextRadius ?? RING_RADIUS }
    }
    const placeShadows = () => {
      for (const fighter of Object.values(activeFighters)) {
        const center = fighter.aggregate.body.getObjectCenterWorld()
        fighter.shadow.isVisible = !fighter.out
        fighter.shadow.position.set(center.x, 0.012, center.z)
      }
    }

    resizeObserver = new ResizeObserver(() => engine.resize())
    resizeObserver.observe(canvas)
    engine.runRenderLoop(() => {
      if (disposed || signal?.aborted) return
      const seconds = Math.min(Math.max(engine.getDeltaTime() / 1000, 1 / 240), 0.05)
      const frozen = paused || !!rules?.snapshot().result || performance.now() < hitStopUntil
      scene.physicsEnabled = !frozen
      arena.update(arenaState(), performance.now())
      if (frozen) { placeShadows(); scene.render(); return }
      if (rules) simulationMs += seconds * 1000
      const now = rules ? simulationMs : performance.now()
      if (rules) {
        updateProductionAttack(activeFighters.p1, now)
        updateProductionAttack(activeFighters.p2, now)
      } else {
        updateAttackReturn(activeFighters.p1, now)
        updateAttackReturn(activeFighters.p2, now)
      }
      drive(activeFighters.p1, seconds, now)
      drive(activeFighters.p2, seconds, now)
      placeShadows()
      scene.render()
      const separationAfterStep = Math.hypot(
        activeFighters.p1.mesh.position.x - activeFighters.p2.mesh.position.x,
        activeFighters.p1.mesh.position.z - activeFighters.p2.mesh.position.z,
      )
      if (separationAfterStep > CONTACT_REARM_DISTANCE) contactArmed = true

      // 場外判定は見た目（草の島）と同じ有効半径で、コマの重心が外へ出たかを見る
      const radius = arenaState().radius
      const outs: PlayerId[] = []
      for (const player of ['p1', 'p2'] as const) {
        const fighter = activeFighters[player]
        const center = fighter.aggregate.body.getObjectCenterWorld()
        if (!hasJustLeftRing(center.x, center.z, fighter.out, radius)) continue
        fighter.out = true
        fighter.input = { x: 0, y: 0 }
        if (fighter.attack?.retreat) {
          fighter.aggregate.body.setMotionType(PhysicsMotionType.DYNAMIC)
          fighter.aggregate.body.setLinearVelocity(Vector3.Zero())
        }
        fighter.attack = null
        fighter.aggregate.shape.filterCollideMask = FIGHTER
        // 接地中の接触ペアは Havok に残るため、外向きの運動で床から確実に離す。
        const outward = new Vector3(center.x, 0, center.z).normalize().scale(EXIT_IMPULSE)
        fighter.aggregate.body.applyImpulse(outward, center)
        outs.push(player)
        onEvent({ type: 'out', player })
      }
      if (rules) {
        const current = rules.step(seconds, pendingHits.splice(0), outs)
        if (simulationMs - lastSnapshotAt >= 100 || current.result) {
          lastSnapshotAt = simulationMs
          options.production!.onSnapshot(current)
        }
      } else {
        finishAttackReturn(activeFighters.p1)
        finishAttackReturn(activeFighters.p2)
      }

      const p1 = activeFighters.p1.mesh.position
      const p2 = activeFighters.p2.mesh.position
      const target = new Vector3((p1.x + p2.x) / 2, CAMERA_TARGET_HEIGHT, (p1.z + p2.z) / 2).add(targetShift)
      const blend = Math.min(1, seconds * 5)
      camera.setTarget(Vector3.Lerp(camera.target, target, blend), false, false, true)
      const separation = Math.hypot(p1.x - p2.x, p1.z - p2.z)
      const cameraRadius = CAMERA_RADIUS * (1 + 0.3 * Math.min(1, separation / 12))
      camera.radius += (cameraRadius - camera.radius) * blend
    })

    return {
      setInput: (player, input) => {
        activeFighters[player].inputAt = performance.now()
        activeFighters[player].input = {
          x: Math.max(-1, Math.min(1, input.x)),
          y: Math.max(-1, Math.min(1, input.y)),
        }
      },
      triggerTestAttack: (player) => {
        const fighter = activeFighters[player]
        const now = performance.now()
        if (fighter.out || fighter.attack || now < fighter.nextAttackAt) return false
        fighter.attack = {
          expiresAt: now + ATTACK_FORWARD_MS,
          consumed: false,
          origin: fighter.mesh.position.clone(),
          retreat: null,
        }
        fighter.nextAttackAt = now + ATTACK_MIN_INTERVAL_MS
        const direction = new Vector3(Math.sin(fighter.movement.yaw), 0, Math.cos(fighter.movement.yaw))
        fighter.aggregate.body.applyImpulse(direction.scale(TEST_IMPULSE), fighter.aggregate.body.getObjectCenterWorld())
        return true
      },
      triggerAttack: (player, button) => {
        const fighter = activeFighters[player]
        if (!rules || paused || fighter.out || fighter.attack || fighter.windup ||
            !rules.acceptAttack(player, button, simulationMs)) return false
        if (button === 'b') {
          const direction = new Vector3(Math.sin(fighter.movement.yaw), 0, Math.cos(fighter.movement.yaw))
          fighter.windup = { endsAt: simulationMs + ATTACKS.b.windupMs, direction }
          const velocity = fighter.aggregate.body.getLinearVelocity()
          fighter.aggregate.body.setLinearVelocity(new Vector3(-direction.x, velocity.y, -direction.z))
          fighter.aggregate.body.setAngularVelocity(Vector3.Zero())
        } else launch(fighter, button, simulationMs)
        return true
      },
      setPaused: (value) => {
        paused = value
        if (value) for (const fighter of Object.values(activeFighters)) {
          fighter.input = { x: 0, y: 0 }
          fighter.movement.smoothedX = fighter.movement.smoothedY = 0
        }
      },
      dispose,
    }
  } catch (cause) {
    dispose()
    throw cause
  }
}

function fighterAttackValue(button?: 'a' | 'b') {
  return button === 'b' ? 2 : TEST_ATTACK_VALUE
}
