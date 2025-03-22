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
  player: {
    client: {
      action: 'set'
      players: PlayersData
    }
    server: {
      players: PlayersData
    }
  }
  settings: {
    client: {
      action: 'set'
      settings: EventSettingsData
    }
    server: {
      settings: EventSettingsData
    }
  }
}

export type WebSocketChannel = keyof Payload

export type WebSocketMessage<T extends WebSocketChannel> =
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

export function createServerMessage<T extends WebSocketChannel>(
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

export function createClientMessage<T extends WebSocketChannel>(
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

export function isServerCardMessage(message: WebSocketMessage<WebSocketChannel>):
  message is WebSocketMessage<'card'> & { payload: Payload['card']['server'] } {
  return message.channel === 'card' && message.direction === 'in'
}

export function isClientCardMessage(message: WebSocketMessage<WebSocketChannel>):
  message is WebSocketMessage<'card'> & { payload: Payload['card']['client'] } {
  return message.channel === 'card' && message.direction === 'out'
}

export function isServerEventMessage(message: WebSocketMessage<WebSocketChannel>):
  message is WebSocketMessage<'event'> & { payload: Payload['event']['server'] } {
  return message.channel === 'event' && message.direction === 'in'
}

export function isClientEventMessage(message: WebSocketMessage<WebSocketChannel>):
  message is WebSocketMessage<'event'> & { payload: Payload['event']['client'] } {
  return message.channel === 'event' && message.direction === 'out'
}

export function isServerPlayerMessage(message: WebSocketMessage<WebSocketChannel>):
  message is WebSocketMessage<'player'> & { payload: Payload['player']['server'] } {
  return message.channel === 'player' && message.direction === 'in'
}

export function isClientPlayerMessage(message: WebSocketMessage<WebSocketChannel>):
  message is WebSocketMessage<'player'> & { payload: Payload['player']['client'] } {
  return message.channel === 'player' && message.direction === 'out'
}

export function isServerSettingsMessage(message: WebSocketMessage<WebSocketChannel>):
  message is WebSocketMessage<'settings'> & { payload: Payload['settings']['server'] } {
  return message.channel === 'settings' && message.direction === 'in'
}

export function isClientSettingsMessage(message: WebSocketMessage<WebSocketChannel>):
  message is WebSocketMessage<'settings'> & { payload: Payload['settings']['client'] } {
  return message.channel === 'settings' && message.direction === 'out'
}
