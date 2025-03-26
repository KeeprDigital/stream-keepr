export const MessageTypes = {
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',

  PING: 'ping',
  PONG: 'pong',

  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  SUBSCRIBED: 'subscribed',
  UNSUBSCRIBED: 'unsubscribed',

  ACTION: 'action',
  SYNC: 'sync',
  ERROR: 'error',
} as const

export const Topics = {
  CONFIG: 'config',
  CARD: 'card',
} as const

export type MessageType = typeof MessageTypes[keyof typeof MessageTypes]

export type Topic = typeof Topics[keyof typeof Topics]

export type SocketMessage<T = any> = {
  type: MessageType
  topic?: string
  payload?: T | null
}

export type TopicMap = {
  [K in Topic]: K extends typeof Topics.CONFIG ? ConfigActionMessage :
    K extends typeof Topics.CARD ? CardActionMessage :
      never
}
export type PayloadType<
  T extends MessageType,
  K extends Topic,
> =
T extends typeof MessageTypes.ERROR ? { message: string, code?: number } :
  T extends typeof MessageTypes.CONNECTION ? { clientId: string } :
    T extends typeof MessageTypes.SUBSCRIBED ? (K extends Topic ? { topic: K } : never) :
      T extends typeof MessageTypes.UNSUBSCRIBED ? (K extends Topic ? { topic: K } : never) :
        T extends typeof MessageTypes.ACTION ? (K extends Topic ? TopicMap[K] : never) :
          never

export type TopicData<K extends Topic> =
  K extends typeof Topics.CONFIG ? ConfigData | null :
    K extends typeof Topics.CARD ? CardData | null :
      never
