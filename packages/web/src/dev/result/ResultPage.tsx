import { useState } from 'react'
import { MOCK_SCANNEES } from '../../app/host/mock/mockScannees'
import { ResultScreen, type RematchChoice } from '../../features/result/ResultScreen'
import { players, type PlayerId } from '../../../../../docs/design/tokens'
import '../../../../../docs/design/tokens.css'
import './resultPage.css'

const NO_CHOICES: Record<PlayerId, RematchChoice | null> = { p1: null, p2: null }
const CHOICES: { choice: RematchChoice | null; label: string }[] = [
  { choice: null, label: '未選択' },
  { choice: 'again', label: 'このまま' },
  { choice: 'rescan', label: 'あたらしく' },
]

/** Issue #45の表示を確認する。確認用の操作は本番フローに持ち込まない。 */
export function ResultPage() {
  const [winner, setWinner] = useState<PlayerId | 'draw'>('p1')
  const [choices, setChoices] = useState(NO_CHOICES)
  return <>
    <ResultScreen winner={winner} looks={MOCK_SCANNEES} choices={choices} />
    <div className="result-preview-controls" aria-label="結果画面の確認用操作">
      {(['p1', 'p2', 'draw'] as const).map((outcome) => <button key={outcome} type="button"
        aria-pressed={winner === outcome} onClick={() => setWinner(outcome)}>
        {outcome === 'draw' ? '引き分け' : `${players[outcome].label}の勝利`}
      </button>)}
      {(['p1', 'p2'] as const).map((player) => <fieldset key={player}>
        <legend>{players[player].label}の選択</legend>
        {CHOICES.map(({ choice, label }) => <button key={label} type="button"
          aria-pressed={choices[player] === choice}
          onClick={() => setChoices((current) => ({ ...current, [player]: choice }))}>{label}</button>)}
      </fieldset>)}
    </div>
  </>
}
