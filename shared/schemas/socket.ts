import type { CardActionMessage, CardApiCall, CardClientAction, CardData } from './card'
import type { ConfigActionMessage, ConfigApiCall, ConfigClientAction, ConfigData } from './config'
import type { EventActionMessage, EventApiCall, EventClientAction, EventData } from './event'
import type { MatchActionMessage, MatchApiCall, MatchClientAction, MatchDataList } from './matches'
import type { OpCardActionMessage, OpCardApiCall, OpCardClientAction, OpCardData } from './opCard'
import { z } from 'zod'

export const MessageTypesSchema = z.enum([
  'connection',
  'disconnect',
  'ping',
  'pong',
  'subscribe',
  'unsubscribe',
  'subscribed',
  'unsubscribed',
  'action',
  'sync',
  'error',
])
export const MessageTypes = MessageTypesSchema.enum
export type MessageType = z.infer<typeof MessageTypesSchema>

export const TopicSchema = z.enum([
  'config',
  'card',
  'opCard',
  'matches',
  'event',
])
export const Topics = TopicSchema.enum
export type Topic = z.infer<typeof TopicSchema>

export type TopicDataMap = {
  config: ConfigData | null
  card: CardData | null
  opCard: OpCardData | null
  matches: MatchDataList | null
  event: EventData | null
}
export type TopicData<K extends Topic> = TopicDataMap[K]

export type TopicActionsMap = {
  config: ConfigClientAction
  card: CardClientAction
  opCard: OpCardClientAction
  matches: MatchClientAction
  event: EventClientAction
}
export type TopicActions<T extends Topic> = TopicActionsMap[T]

export type TopicMap = {
  config: ConfigActionMessage
  card: CardActionMessage
  opCard: OpCardActionMessage
  matches: MatchActionMessage
  event: EventActionMessage
}

export type TopicApiCallMap = {
  config: ConfigApiCall
  card: CardApiCall
  opCard: OpCardApiCall
  matches: MatchApiCall
  event: EventApiCall
}

export type SocketMessage<T = unknown> = {
  type: MessageType
  topic?: string
  payload?: T | null
}

export type TypedSocketMessage =
  | { type: typeof MessageTypes.error, topic?: undefined, payload: { message: string, code?: number } }
  | { type: typeof MessageTypes.connection, topic?: undefined, payload: { clientId: string } }
  | { type: typeof MessageTypes.ping, topic?: undefined, payload?: null }
  | { type: typeof MessageTypes.pong, topic?: undefined, payload?: null }
  | { type: typeof MessageTypes.disconnect, topic?: undefined, payload?: null }
  | { type: typeof MessageTypes.subscribe, topic: Topic, payload: { topic: Topic } }
  | { type: typeof MessageTypes.unsubscribe, topic: Topic, payload: { topic: Topic } }
  | { type: typeof MessageTypes.subscribed, topic: Topic, payload: { topic: Topic } | TopicData<Topic> }
  | { type: typeof MessageTypes.unsubscribed, topic: Topic, payload: { topic: Topic } }
  | { type: typeof MessageTypes.action, topic: Topic, payload: TopicMap[Topic] }
  | { type: typeof MessageTypes.sync, topic: Topic, payload: TopicData<Topic> }
