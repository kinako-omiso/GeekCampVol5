import { useState } from 'react'
import { PhoneCloud, PhoneStage } from '../../components/PhoneStage'
import { Svg } from '../../components/Svg'
import { players, type PlayerId } from '../../../../../docs/design/tokens'
import isleUrl from '../../../../../docs/design/assets/isle.svg'
import sampleMugUrl from '../../../../../docs/design/assets/sample-scannee-mug.svg'
import eyesHappyUrl from '../../../../../docs/design/assets/eyes/happy.svg'
import eyesLookRightUrl from '../../../../../docs/design/assets/eyes/look-right.svg'
import flagSvg from '../../../../../docs/design/assets/flag.svg?raw'
import checkIcon from '../../../../../docs/design/assets/icons/check.svg?raw'
import phoneLandscapeIcon from '../../../../../docs/design/assets/icons/phone-landscape.svg?raw'
import './orient.css'

type Props = {
  player: PlayerId
}

/**
 * スマホ：向き調整画面（MVP では枠だけ）。
 * 傾けてコマを回すのは後続の issue。今は見本のコマが回るアニメーションと「けってい」だけ。
 */
export function OrientScreen({ player }: Props) {
  const [confirmed, setConfirmed] = useState(false)

  return (
    <PhoneStage player={player} className="orient">
      <PhoneCloud className="orient__cloud orient__cloud--left" />
      <PhoneCloud className="orient__cloud orient__cloud--top" />

      <div className="orient__layout">
        <div className="orient__left">
          <div className="ss-display phone-ol-s orient__player">{players[player].label}</div>

          <div className="orient__scene">
            <img className="orient__isle" src={isleUrl} alt="" />
            <svg className="orient__arrows" viewBox="0 0 480 200" aria-hidden="true">
              <g fill="none" strokeLinecap="round" strokeLinejoin="round">
                {['M92 40C40 70 40 140 92 170', 'M74 152l18 18-24 5', 'M388 170C440 140 440 70 388 40', 'M406 58l-18-18 24-5'].map(
                  (d) => (
                    <g key={d}>
                      <path d={d} className="orient__arrow-outline" strokeWidth={16} />
                      <path d={d} className="orient__arrow-fill" strokeWidth={8} />
                    </g>
                  ),
                )}
              </g>
            </svg>
            <div className={confirmed ? 'orient__piece' : 'orient__piece orient__piece--turning'}>
              <img className="orient__piece-body" src={sampleMugUrl} alt="じぶんのコマ。目のむきが まえ" />
              <img className="orient__piece-eyes" src={confirmed ? eyesHappyUrl : eyesLookRightUrl} alt="" />
              <svg className="orient__piece-front" viewBox="0 0 60 50" aria-hidden="true">
                <path d="M8 8L50 25L8 42L18 25Z" />
              </svg>
            </div>
          </div>

          <div className="orient__hint">
            <Svg markup={phoneLandscapeIcon} className="orient__hint-icon" />
            <span>かたむけて まわそう</span>
          </div>
        </div>

        <div className="orient__right">
          <button
            type="button"
            className="orient__go"
            aria-label="このむきで けってい"
            disabled={confirmed}
            onClick={() => setConfirmed(true)}
          >
            <Svg markup={checkIcon} className="orient__go-icon" />
            <span className="ss-display orient__go-label">けってい</span>
          </button>
        </div>
      </div>

      {confirmed && (
        <div className="orient__ready" role="status">
          <Svg markup={flagSvg} className="orient__flag" />
          <div className="orient__ready-text">
            <div className="ss-display phone-ol orient__ready-title">じゅんびOK!</div>
            <div className="orient__ready-sub">
              <span>あいてを まってね</span>
              <span className="orient__dots" aria-hidden="true">
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
