import { PhysicsBattleTest } from '../../features/battle/ui/PhysicsBattleTest'

export function PhysicsPage() {
  return <main className="physics-dev">
    <header>
      <a href="/host">トップへ戻る</a>
      <p>ISSUE #6 · 物理検証</p>
      <h1>衝突と場外判定</h1>
      <p>Quick Scan の同じサンプル形状を2体使い、Havok の衝突を確認します。</p>
    </header>
    <PhysicsBattleTest />
  </main>
}
