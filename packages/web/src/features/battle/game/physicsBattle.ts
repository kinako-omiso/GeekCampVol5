import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
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
import { createSampleMask } from './sampleMask'

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

type TestAttack = {
  expiresAt: number
  consumed: boolean
  origin: Vector3
  retreat: { startedAt: number; from: Vector3; reachedTarget: boolean } | null
}

type Fighter = {
  mesh: Mesh
  aggregate: PhysicsAggregate
  movement: MovementState
  input: MotionInput
  out: boolean
  attack: TestAttack | null
  nextAttackAt: number
  driveLockUntil: number
  attackMultiplier: number
}

export type PhysicsBattleEvent =
  | { type: 'contact' }
  | { type: 'hit'; attacker: PlayerId; target: PlayerId; impulse: number }
  | { type: 'out'; player: PlayerId }
export type PhysicsBattle = {
  setInput: (player: PlayerId, input: MotionInput) => void
  triggerTestAttack: (player: PlayerId) => boolean
  dispose: () => void
}

function createFighter(scene: Scene, player: PlayerId, reconstruction: ReturnType<typeof reconstructQuickScan>): Fighter {
  const center = getVolumeCentroid(reconstruction)
  const centered = new Float32Array(reconstruction.positions.length)
  let bottom = Infinity
  for (let index = 0; index < centered.length; index += 3) {
    centered[index] = reconstruction.positions[index] - (center?.x ?? 0)
    centered[index + 1] = reconstruction.positions[index + 1] - (center?.y ?? 0)
    centered[index + 2] = reconstruction.positions[index + 2] - (center?.z ?? 0)
    bottom = Math.min(bottom, centered[index + 1])
  }

  const mesh = new Mesh(player + '-fighter', scene)
  const vertexData = new VertexData()
  vertexData.positions = centered
  vertexData.indices = reconstruction.indices
  if (reconstruction.normals) vertexData.normals = reconstruction.normals
  vertexData.applyToMesh(mesh)
  const yaw = player === 'p1' ? Math.PI / 2 : -Math.PI / 2
  mesh.position.set(player === 'p1' ? -3 : 3, -bottom + 0.04, 0)
  mesh.rotationQuaternion = Quaternion.RotationYawPitchRoll(yaw, 0, 0)

  const bodyMaterial = new StandardMaterial(player + '-body', scene)
  bodyMaterial.diffuseColor = Color3.FromHexString('#dddddd')
  bodyMaterial.specularColor = new Color3(0.12, 0.12, 0.12)
  bodyMaterial.sideOrientation = Material.ClockWiseSideOrientation
  mesh.material = bodyMaterial

  const ringMaterial = new StandardMaterial(player + '-ring-material', scene)
  ringMaterial.diffuseColor = Color3.FromHexString(players[player].main)
  ringMaterial.emissiveColor = Color3.FromHexString(players[player].dark)
  const ring = MeshBuilder.CreateTorus(player + '-ring', { diameter: 1.25, thickness: 0.055, tessellation: 48 }, scene)
  ring.parent = mesh
  ring.position.y = bottom + 0.03
  ring.material = ringMaterial
  const front = MeshBuilder.CreateBox(player + '-front', { width: 0.2, height: 0.035, depth: 0.28 }, scene)
  front.parent = mesh
  front.position.set(0, bottom + 0.06, 0.55)
  front.material = ringMaterial

  // 凸包は Havok の衝突用形状。能力値を出す C++ の形状解析には使わない。
  const aggregate = new PhysicsAggregate(mesh, PhysicsShapeType.CONVEX_HULL, {
    mass: 1,
    friction: 0.65,
    restitution: 0.05,
  }, scene)
  aggregate.shape.filterMembershipMask = FIGHTER
  aggregate.shape.filterCollideMask = FIGHTER | FLOOR_REGION
  aggregate.body.setMassProperties({
    mass: 1,
    inertia: new Vector3(0, 0.2, 0),
    inertiaOrientation: Quaternion.Identity(),
  })
  aggregate.body.setLinearDamping(0.35)
  aggregate.body.setAngularDamping(4)

  return {
    mesh,
    aggregate,
    movement: { x: mesh.position.x, z: mesh.position.z, yaw, smoothedX: 0, smoothedY: 0 },
    input: { x: 0, y: 0 },
    out: false,
    attack: null,
    nextAttackAt: 0,
    driveLockUntil: 0,
    attackMultiplier: TEST_ATTACK_MULTIPLIERS[player],
  }
}

function drive(fighter: Fighter, seconds: number, now: number) {
  if (fighter.out || fighter.attack?.retreat || now < fighter.driveLockUntil) return
  const body = fighter.aggregate.body
  const position = fighter.mesh.position
  const previousYaw = fighter.movement.yaw
  const next = stepMovement(
    { ...fighter.movement, x: position.x, z: position.z },
    fighter.input,
    seconds,
    { x: 1, z: 0 },
    { x: 0, z: 1 },
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

/** #6 用の2体物理検証。React側は入力とイベント表示だけを担当する。 */
export async function mountPhysicsBattle(
  canvas: HTMLCanvasElement,
  onEvent: (event: PhysicsBattleEvent) => void,
  signal?: AbortSignal,
): Promise<PhysicsBattle> {
  const engine = createWebGL2Engine(canvas)
  const scene = new Scene(engine)
  let resizeObserver: ResizeObserver | undefined
  let groundBody: PhysicsBody | undefined
  let floorShape: PhysicsShapeContainer | undefined
  let floorRegion: PhysicsShapeCylinder | undefined
  let fighters: Record<PlayerId, Fighter> | undefined
  let disposed = false

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
    await enableHavok(scene)
    if (signal?.aborted) throw new DOMException('中断しました。', 'AbortError')

    const sky = Color3.FromHexString(colors.sky)
    scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1)
    const ground = MeshBuilder.CreateCylinder('arena', { diameter: RING_RADIUS * 2, height: 0.12, tessellation: 96 }, scene)
    ground.position.y = -0.06
    const grass = new StandardMaterial('arena-grass', scene)
    grass.diffuseColor = Color3.FromHexString(colors.grass)
    ground.material = grass
    const rim = MeshBuilder.CreateTorus('arena-rim', { diameter: RING_RADIUS * 2, thickness: 0.09, tessellation: 96 }, scene)
    rim.position.y = 0.04
    const rimMaterial = new StandardMaterial('arena-rim-material', scene)
    rimMaterial.diffuseColor = Color3.FromHexString(colors.grassLight)
    rimMaterial.emissiveColor = Color3.FromHexString(colors.grassStripe)
    rim.material = rimMaterial

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
      p1: createFighter(scene, 'p1', reconstruction),
      p2: createFighter(scene, 'p2', reconstruction),
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
      const now = performance.now()
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
        const impulse = calculateKnockbackImpulse({ attackValue: TEST_ATTACK_VALUE, attackMultiplier: attacker.attackMultiplier })
        targetBody.applyImpulse(outward.scale(impulse), targetCenter)
        attacker.driveLockUntil = Math.max(attacker.driveLockUntil, now + ATTACKER_DRIVE_LOCK_MS)
        defender.driveLockUntil = Math.max(defender.driveLockUntil, now + DEFENDER_DRIVE_LOCK_MS)
        attacker.movement.smoothedX = attacker.movement.smoothedY = 0
        defender.movement.smoothedX = defender.movement.smoothedY = 0
        onEvent({ type: 'hit', attacker: player, target, impulse })
      }
    })

    const ambient = new HemisphericLight('ambient', Vector3.Up(), scene)
    ambient.intensity = 0.65
    const key = new DirectionalLight('key', new Vector3(-0.5, -1, 0.4), scene)
    key.intensity = 0.8
    const camera = new ArcRotateCamera(
      'battle-camera', -Math.PI / 4, Math.PI / 2 - 50 * Math.PI / 180,
      13, new Vector3(0, 0.3, 0), scene,
    )
    camera.lowerRadiusLimit = 13
    camera.upperRadiusLimit = 16.9

    resizeObserver = new ResizeObserver(() => engine.resize())
    resizeObserver.observe(canvas)
    engine.runRenderLoop(() => {
      if (disposed || signal?.aborted) return
      const seconds = Math.min(Math.max(engine.getDeltaTime() / 1000, 1 / 240), 0.05)
      const now = performance.now()
      updateAttackReturn(activeFighters.p1, now)
      updateAttackReturn(activeFighters.p2, now)
      drive(activeFighters.p1, seconds, now)
      drive(activeFighters.p2, seconds, now)
      scene.render()
      const separationAfterStep = Math.hypot(
        activeFighters.p1.mesh.position.x - activeFighters.p2.mesh.position.x,
        activeFighters.p1.mesh.position.z - activeFighters.p2.mesh.position.z,
      )
      if (separationAfterStep > 2) contactArmed = true

      for (const player of ['p1', 'p2'] as const) {
        const fighter = activeFighters[player]
        const center = fighter.aggregate.body.getObjectCenterWorld()
        if (!hasJustLeftRing(center.x, center.z, fighter.out)) continue
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
        onEvent({ type: 'out', player })
      }
      finishAttackReturn(activeFighters.p1)
      finishAttackReturn(activeFighters.p2)

      const p1 = activeFighters.p1.mesh.position
      const p2 = activeFighters.p2.mesh.position
      const target = new Vector3((p1.x + p2.x) / 2, 0.3, (p1.z + p2.z) / 2)
      const blend = Math.min(1, seconds * 5)
      camera.setTarget(Vector3.Lerp(camera.target, target, blend), false, false, true)
      const separation = Math.hypot(p1.x - p2.x, p1.z - p2.z)
      const radius = 13 * (1 + 0.3 * Math.min(1, separation / 12))
      camera.radius += (radius - camera.radius) * blend
    })

    return {
      setInput: (player, input) => {
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
      dispose,
    }
  } catch (cause) {
    dispose()
    throw cause
  }
}
