import type { CardData, CardDisplayData } from './cardData'

export type MessageType = 'card' | 'serverCard'

export type BaseMessage = {
  type: MessageType
  timestamp: number
  id: string
}

export type CardServerMessage = {
  type: 'serverCard'
  payload: {
    card: CardData
    display: CardDisplayData
  }
} & BaseMessage

export type CardClientMessage = {
  type: 'card'
  payload: CardClientPayload
} & BaseMessage

export type ClientCardAction =
  | 'set'
  | 'clear'
  | 'hide'
  | 'show'
  | 'rotate'
  | 'counterRotate'
  | 'flip'
  | 'turnOver'

export type CardClientPayload = {
  action: ClientCardAction
} & (
  | {
    action: Exclude<ClientCardAction, 'set'>
    card?: never
  }
  | {
    action: 'set'
    card: CardData
  }
)

export type WebSocketMessage =
  | CardClientMessage
  | CardServerMessage
export function createWebSocketMessage<T extends WebSocketMessage>(
  type: MessageType,
  payload: T['payload'],
) {
  return JSON.stringify({
    type,
    timestamp: Date.now(),
    id: crypto.randomUUID(),
    payload,
  } as T)
}
