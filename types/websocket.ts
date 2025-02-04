import type { CardData, CardDisplayData } from './cardData'

type CardClientAction =
  | 'set'
  | 'clear'
  | 'hide'
  | 'show'
  | 'rotate'
  | 'counterRotate'
  | 'flip'
  | 'turnOver'
export type Payload = {
  card: {
    outgoing: {
      action: CardClientAction
    } & (
      | {
        action: Exclude<CardClientAction, 'set'>
        card?: never
      }
      | {
        action: 'set'
        card: CardData
      }
    )
    incoming: {
      display: CardDisplayData | null
      card: CardData | null
    }
  }
}

export type WebSocketChannel = keyof Payload

export type WebSocketMessage<T extends WebSocketChannel> =
  | {
    direction: 'out'
    channel: T
    payload: Payload[T]['outgoing']
  }
  | {
    direction: 'in'
    channel: T
    payload: Payload[T]['incoming']
  }

// type ServerMessage<T extends keyof Payload> = {
//   channel: T
//   direction: 'in'
//   payload: Payload[T]['incoming']
//   timestamp: string
//   messageId: string
// }

// type ClientMessage<T extends keyof Payload> = {
//   channel: T
//   direction: 'out'
//   payload: Payload[T]['outgoing']
//   timestamp: string
//   messageId: string
// }

export function createServerMessage<T extends keyof Payload>(
  channel: T,
  payload: Payload[T]['incoming'],
) {
  return JSON.stringify({
    channel,
    direction: 'in',
    payload,
    timestamp: new Date().toISOString(),
    messageId: crypto.randomUUID(),
  })
}

export function createClientMessage<T extends keyof Payload>(
  channel: T,
  payload: Payload[T]['outgoing'],
) {
  return JSON.stringify({
    channel,
    direction: 'out',
    payload,
    timestamp: new Date().toISOString(),
    messageId: crypto.randomUUID(),
  })
}
