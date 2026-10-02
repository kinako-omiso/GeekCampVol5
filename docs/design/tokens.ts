/**
 * Scannee's Summit デザイントークン(案2「そらの てっぺん」)
 * tokens.css と同じ値。React から色を渡すときや、Babylon.js の Color3 に使う。
 *   例: Color3.FromHexString(colors.grass)
 */

export const colors = {
  sky: '#8FDBFF',
  mountainFar: '#79C9EF',
  mountainFar2: '#62B8E4',
  cloud: '#FFFFFF',
  cloudShade: '#E4F4FF',
  grass: '#6BD66B',
  grassLight: '#8BE68B',
  grassStripe: '#7DDE7D',
  rock: '#C08F68',
  rockDark: '#946848',
  sun: '#FFC93C',
  sunDeep: '#FF9F1C',
  sunPale: '#FFE27A',
  ink: '#231A3D',
  inkSoft: '#5A4F75',
  muted: '#A39BB8',
  mutedBg: '#E2DCEB',
  cream: '#FFF8EC',
  ice: '#E9F7FF',
} as const;

export type PlayerId = 'p1' | 'p2';

export const players = {
  p1: { label: '1P', main: '#2F6BFF', dark: '#1B3FA8', light: '#9CC0FF', shade: '#7DA5F5' },
  p2: { label: '2P', main: '#E8284F', dark: '#9E1233', light: '#FFA3B8', shade: '#F4829D' },
} as const satisfies Record<PlayerId, { label: string; main: string; dark: string; light: string; shade: string }>;

export const fonts = {
  display: "'Mochiy Pop One', sans-serif",
  body: "'M PLUS Rounded 1c', sans-serif",
} as const;

/**
 * 演出の時間(秒)。
 * 「spec」は仕様書の値、「draft」はデザイン案の仮の値(遊んで調整する)。
 */
export const timing = {
  hitStop: 0.05, // spec
  hitFlash: 0.1, // spec: 被弾したコマを白く点滅
  bWindup: 0.3, // spec: 体当たり中の予備動作(後ろに引く)
  bCooldown: 3, // spec
  aMinInterval: 0.4, // spec
  shrinkWarning: 3, // spec: 縮小の予告(「まんなかへ にげて!」)
  entrancePerPlayer: 6, // spec: 登場演出の1人ぶん(見本 pc-04-entrance の流れと同じ)
  countdownStep: 0.8, // draft: 3・2・1・GO! の1コマ
  finishImpactFreeze: 0.7, // draft: 決着の最後の一撃で止める(暗転ストップ)
  finishHold: 2, // draft: 決着の文字を見せる時間
} as const;

export const vibration = {
  hit: 30, // spec(ms)
  hurt: 60, // spec(ms)
  lose: [60, 40, 120], // spec
} as const;

/**
 * Scannee の目の表情。assets/eyes/<name>.svg と対応する。
 * どの場面でどの表情にするかは eyeFor を使う。
 */
export type EyeState =
  | 'look-right'
  | 'look-left'
  | 'shut'
  | 'angry-right'
  | 'angry-left'
  | 'hurt'
  | 'dizzy'
  | 'star'
  | 'happy'
  | 'sad';

export const eyeFor = {
  idle: 'look-right', // 見ている方が「まえ」。実際は向きに合わせて left/right
  entranceBeforeOpen: 'shut', // 登場で着地するまで
  bCharging: 'angry-right', // B の予備動作中・VS
  hurt: 'hurt', // 被弾(白点滅と同時)
  ko: 'dizzy', // HP0 で飛ばされるとき
  winner: 'star', // 勝ち
  ready: 'happy', // 向き調整で確定・負けたあとの拍手
  loserTimeUp: 'sad', // 山くらべで負け
  disconnected: 'shut', // 切断中(寝顔)
} as const satisfies Record<string, EyeState>;

/** ステージの基準サイズ。PC は 16:9 のまま拡大縮小、スマホは横持ち固定。 */
export const stage = {
  pc: { width: 1280, height: 720 },
  phoneLandscape: { width: 844, height: 390 },
} as const;
