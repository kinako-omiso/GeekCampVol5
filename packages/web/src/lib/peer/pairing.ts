import {
  pairingMetadataSchema,
  PROTOCOL_VERSION,
  type PairingMetadata,
  type PlayerSlot,
} from '@gikcamp/protocol'

export type ControllerPairing = {
  hostPeerId: string
  metadata: PairingMetadata
}

// QRコードのトークン生成
export function generatePairingToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  return Array.from(
    bytes,
    (value) => value.toString(16).padStart(2, '0'),
  ).join('')
}

// ParingMetadataの作成
export function createPairingMetadata(
  slot: PlayerSlot,
): PairingMetadata {
  return {
    slot,
    token: generatePairingToken(),
    protocolVersion: PROTOCOL_VERSION,
  }
}

// URL作成
export function buildControllerUrl(
  origin: string,
  hostPeerId: string,
  metadata: PairingMetadata,
): string {
  const url = new URL('/controller', origin)

  url.searchParams.set('hostPeerId', hostPeerId)
  url.searchParams.set('slot', String(metadata.slot))
  url.searchParams.set('token', metadata.token)
  url.searchParams.set('v', metadata.protocolVersion)

  return url.toString()
}

// URLの解析
export function parseControllerPairing(
  searchParams: URLSearchParams,
): ControllerPairing | null {
  const hostPeerId = searchParams.get('hostPeerId')

  if (hostPeerId === null || hostPeerId.trim() === '') {
    return null
  }

  const metadataResult = pairingMetadataSchema.safeParse({
    slot: Number(searchParams.get('slot')),
    token: searchParams.get('token'),
    protocolVersion: searchParams.get('v'),
  })

  if (!metadataResult.success) {
    return null
  }

  return {
    hostPeerId,
    metadata: metadataResult.data,
  }
}