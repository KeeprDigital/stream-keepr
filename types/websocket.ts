import type { CardData, CardDisplayData } from './cardData'
import type { EventData } from './eventData'

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
    client: {
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
    server: {
      display: CardDisplayData | null
      card: CardData | null
    }
  }
  event: {
    client: {
      action: 'set'
      event: EventData
    }
    server: {
      event: EventData
    }
  }
}

export type WebSocketMessage<T extends keyof Payload> =
  | {
    direction: 'out'
    channel: T
    payload: Payload[T]['client']
  }
  | {
    direction: 'in'
    channel: T
    payload: Payload[T]['server']
  }

export function createServerMessage<T extends keyof Payload>(
  channel: T,
  payload: Payload[T]['server'],
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
  payload: Payload[T]['client'],
) {
  return JSON.stringify({
    channel,
    direction: 'out',
    payload,
    timestamp: new Date().toISOString(),
    messageId: crypto.randomUUID(),
  })
}

export function isServerCardMessage(message: WebSocketMessage<keyof Payload>):
  message is WebSocketMessage<'card'> & { payload: Payload['card']['server'] } {
  return message.channel === 'card' && message.direction === 'in'
}

export function isClientCardMessage(message: WebSocketMessage<keyof Payload>):
  message is WebSocketMessage<'card'> & { payload: Payload['card']['client'] } {
  return message.channel === 'card' && message.direction === 'out'
}

export function isServerEventMessage(message: WebSocketMessage<keyof Payload>):
  message is WebSocketMessage<'event'> & { payload: Payload['event']['server'] } {
  return message.channel === 'event' && message.direction === 'in'
}

export function isClientEventMessage(message: WebSocketMessage<keyof Payload>):
  message is WebSocketMessage<'event'> & { payload: Payload['event']['client'] } {
  return message.channel === 'event' && message.direction === 'out'
}
