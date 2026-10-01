import { useRef, useState } from 'react'
import { PhoneCloud, PhoneStage } from '../../components/PhoneStage'
import { Scannee } from '../../components/Scannee'
import type { ScanneeLook } from '../../components/scanneeLook'
import { Svg } from '../../components/Svg'
import { players, type PlayerId } from '../../../../../docs/design/tokens'
import eyesHappyUrl from '../../../../../docs/design/assets/eyes/happy.svg'
import againIcon from '../../../../../docs/design/assets/icons/again.svg?raw'
import cameraIcon from '../../../../../docs/design/assets/icons/camera.svg?raw'
import sparkleUrl from '../../../../../docs/design/assets/sparkle.svg'
import './rematch.css'

/** 試合のあとの選択。again：同じコマでもう一度 / rescan：スキャンからやり直す */
export type RematchChoice = 'again' | 'rescan'

type Props = {
  player: PlayerId
  // じぶんのコマの見た目（「このまま」のボタンに出す）
  look: ScanneeLook
  // 選んだときに呼ぶ。PC への送信は呼び出し側で行う
  onChoose?: (choice: RematchChoice) => void
}

/**
 * スマホ：結果画面（再戦の2択）。「このまま もういっかい」か「あたらしく スキャン」をタップで選ぶ。
 * 選んだら相手待ち（OK! あいてを まってね）。一度選んだら変えられない。
 * 見本：docs/design/screens/phone-05-result.html
 */
export function RematchScreen({ player, look, onChoose }: Props) {
  const [choice, setChoice] = useState<RematchChoice | null>(null)
  // 再描画を待たずに弾くための印。同じフレームで2つのボタンが押されても1回だけ送る
  const chosenRef = useRef(false)

  const choose = (next: RematchChoice) => {
    if (chosenRef.current) return
    chosenRef.current = true
    setChoice(next)
    onChoose?.(next)
  }

  return (
    <PhoneStage player={player} className="rematch">
      <PhoneCloud className="rematch__cloud" />

      <header className="rematch__head">
        <div className="ss-display phone-ol-s rematch__player">{players[player].label}</div>
        <h1 className="ss-display phone-ol rematch__title">つぎは どうする?</h1>
      </header>

      <div className="rematch__picks">
        <button
          type="button"
          className="rematch__pick rematch__pick--again"
          disabled={choice !== null}
          onClick={() => choose('again')}
        >
          <div className="rematch__art rematch__art--again">
            <Scannee look={look} eyesUrl={eyesHappyUrl} className="rematch__scannee" />
            <div className="rematch__badge">
              <Svg markup={againIcon} className="rematch__badge-icon" />
            </div>
          </div>
          <span className="ss-display rematch__pick-title">このまま</span>
          <span className="rematch__pick-sub">もういっかい!</span>
        </button>

        <button
          type="button"
          className="rematch__pick rematch__pick--rescan"
          disabled={choice !== null}
          onClick={() => choose('rescan')}
        >
          <div className="rematch__art">
            <Svg markup={cameraIcon} className="rematch__camera" />
            <img className="rematch__spark" src={sparkleUrl} alt="" />
          </div>
          <span className="ss-display rematch__pick-title">あたらしく</span>
          <span className="rematch__pick-sub">スキャン!</span>
        </button>
      </div>

      {choice !== null && (
        <div className="rematch__waiting" role="status">
          <div className="rematch__chosen">
            <Svg markup={choice === 'again' ? againIcon : cameraIcon} className="rematch__chosen-icon" />
          </div>
          <div className="rematch__waiting-text">
            <div className="ss-display phone-ol rematch__ok">OK!</div>
            <div className="rematch__waiting-sub">
              <span>あいてを まってね</span>
              <span className="rematch__dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        </div>
      )}
    </PhoneStage>
  )
}
