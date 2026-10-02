import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'
import type { ReconstructionResult } from '../../analyze/reconstruction/types'

/** 配置確認と対戦で同じ生成メッシュを表示する。 */
export function createFighterMesh(scene: Scene, name: string, reconstruction: ReconstructionResult): Mesh {
  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = reconstruction.positions
  data.indices = reconstruction.indices
  if (reconstruction.normals) data.normals = reconstruction.normals
  else {
    const normals: number[] = []
    VertexData.ComputeNormals(reconstruction.positions, reconstruction.indices, normals)
    data.normals = normals
  }
  data.applyToMesh(mesh)
  const material = new StandardMaterial(name + '-material', scene)
  material.diffuseColor = Color3.FromHexString('#dddddd')
  material.specularColor = new Color3(0.12, 0.12, 0.12)
  material.sideOrientation = Material.ClockWiseSideOrientation
  mesh.material = material
  return mesh
}
