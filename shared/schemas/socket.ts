import type { CardClientAction, CardData } from './card'
import type { ConfigClientAction, ConfigData } from './config'
import { z } from 'zod'
import { cardActionMessageSchema } from './card'
import { configActionMessageSchema } from './config'

// Message types
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

// Topics
export const TopicSchema = z.enum([
  'config',
  'card',
])
export const Topics = TopicSchema.enum
export type Topic = z.infer<typeof TopicSchema>

// Direct mapping of topics to their data types
export type TopicDataMap = {
  config: ConfigData | null
  card: CardData | null
}
export type TopicData<K extends Topic> = TopicDataMap[K]

// Direct mapping of topics to their action message types
export type TopicMap = {
  config: z.infer<typeof configActionMessageSchema>
  card: z.infer<typeof cardActionMessageSchema>
}

// Direct mapping of message types to their payload types
export type MessagePayloadMap = {
  error: { message: string, code?: number }
  connection: { clientId: string }
  subscribed: { topic: Topic }
  unsubscribed: { topic: Topic }
  subscribe: { topic: Topic }
  unsubscribe: { topic: Topic }
  action: never // Requires topic context
  sync: never // Requires topic context
  ping: null
  pong: null
  disconnect: null
}

// Generic socket message type
export type SocketMessage<T = unknown> = {
  type: MessageType
  topic?: string
  payload?: T | null
}

// Type-safe payload type that handles topic-specific cases
export type PayloadType<
  T extends MessageType,
  K extends Topic,
> = T extends keyof MessagePayloadMap
  ? MessagePayloadMap[T] extends never
    ? T extends typeof MessageTypes.action
      ? TopicMap[K]
      : T extends typeof MessageTypes.sync
        ? TopicData<K>
        : never
    : MessagePayloadMap[T]
  : never

// Schema for topic map (for Zod validation)
export const TopicMapSchema = z.record(
  TopicSchema,
  z.discriminatedUnion('topic', [
    z.object({
      topic: z.literal(Topics.config),
      action: configActionMessageSchema,
    }),
    z.object({
      topic: z.literal(Topics.card),
      action: cardActionMessageSchema,
    }),
  ]),
)

// Type-safe discriminated union for socket messages
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

// Map topics to their action types (reusing existing definitions)
export type TopicActionsMap = {
  config: ConfigClientAction
  card: CardClientAction
}
export type TopicActions<T extends Topic> = TopicActionsMap[T]

// Extract action literals from a Zod enum schema
export type ExtractZodEnumValues<T extends z.ZodEnum<[string, ...string[]]>> =
  T['_def']['values'][number]
