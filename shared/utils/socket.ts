import type { TopicRegistry } from '~~/server/topics/registry'
import type {
  MessageType,
  SocketMessage,
  Topic,
  TopicData,
  TopicMap,
} from '../schemas/socket'
import { cardClientActionSchema } from '../schemas/card'
import { configClientActionSchema } from '../schemas/config'
import { eventClientActionSchema } from '../schemas/event'
import { matchClientActionSchema } from '../schemas/matches'
import { opCardClientActionSchema } from '../schemas/opCard'
import { MessageTypes, Topics } from '../schemas/socket'

/**
 * Type-safe dispatcher for topic action handlers
 */
export function dispatchTopicAction<K extends Topic>(
  topic: K,
  payload: unknown,
  registry: TopicRegistry,
): Promise<TopicData<K>> {
  if (!isValidActionMessage(topic, payload)) {
    throw new Error('Invalid action payload')
  }
  return registry[topic].onAction(payload)
}

/**
 * Type guard for topics
 * @param topic - The topic to check
 * @returns True if the topic is a valid topic, false otherwise
 */
export function isValidTopic(topic: string): topic is Topic {
  return Object.values(Topics).includes(topic as Topic)
}

/**
 * Type guard for message types
 * @param type - The type to check
 * @returns True if the type is a valid message type, false otherwise
 */
export function isMessageType(type: string): type is MessageType {
  return Object.values(MessageTypes).includes(type as MessageType)
}

/**
 * Type predicate to check if a message is a valid action message for a topic
 */
export function isValidActionMessage<K extends Topic>(
  topic: K,
  payload: unknown,
): payload is TopicMap[K] {
  if (!payload || typeof payload !== 'object' || !('action' in payload)) {
    return false
  }

  if (topic === 'config') {
    return configClientActionSchema.safeParse(payload.action).success
  }
  else if (topic === 'card') {
    return cardClientActionSchema.safeParse(payload.action).success
  }
  else if (topic === 'matches') {
    return matchClientActionSchema.safeParse(payload.action).success
  }
  else if (topic === 'event') {
    return eventClientActionSchema.safeParse(payload.action).success
  }
  else if (topic === 'opCard') {
    return opCardClientActionSchema.safeParse(payload.action).success
  }
  return false
}

/**
 * Create a type-safe message with function overloads for better type inference
 */
export function createMessage<T extends typeof MessageTypes.error>(
  type: T,
  topic?: undefined,
  payload?: { message: string, code?: number }
): SocketMessage<{ message: string, code?: number }>
export function createMessage<T extends typeof MessageTypes.connection>(
  type: T,
  topic?: undefined,
  payload?: { clientId: string }
): SocketMessage<{ clientId: string }>
export function createMessage<T extends typeof MessageTypes.ping | typeof MessageTypes.pong | typeof MessageTypes.disconnect>(
  type: T,
  topic?: undefined,
  payload?: null
): SocketMessage<null>
export function createMessage<
  T extends typeof MessageTypes.subscribe | typeof MessageTypes.unsubscribe | typeof MessageTypes.subscribed | typeof MessageTypes.unsubscribed,
  K extends Topic,
>(
  type: T,
  topic: K,
  payload?: { topic: K }
): SocketMessage<{ topic: K }>
export function createMessage<T extends typeof MessageTypes.action, K extends Topic>(
  type: T,
  topic: K,
  payload: TopicMap[K]
): SocketMessage<TopicMap[K]>
export function createMessage<T extends typeof MessageTypes.sync, K extends Topic>(
  type: T,
  topic: K,
  payload?: TopicData<K>
): SocketMessage<TopicData<K>>
export function createMessage<T extends MessageType, K extends Topic | undefined = undefined>(
  type: T,
  topic?: K,
  payload?: unknown,
): SocketMessage<unknown> {
  return {
    type,
    topic,
    payload,
  }
}

/**
 * Create a type-safe sync message
 * @param topic - The topic of the message
 * @param payload - The payload of the message
 * @returns The message
 */
export function createSyncMessage<K extends Topic>(
  topic: K,
  payload?: TopicData<K> | null,
): SocketMessage<TopicData<K> | null> {
  return {
    type: MessageTypes.sync,
    topic,
    payload,
  }
}

/**
 * Create a type-safe subscribed message
 * @param topic - The topic of the message
 * @param payload - The payload of the message
 * @returns The message
 */
export function createSubscribedMesage<K extends Topic>(
  topic: K,
  payload?: TopicData<K> | null,
): SocketMessage<TopicData<K> | null> {
  return {
    type: MessageTypes.subscribed,
    topic,
    payload,
  }
}
