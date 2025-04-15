import type { TopicRegistry } from '~~/server/topics/registry'
import type {
  MessageType,
  SocketMessage,
  Topic,
  TopicActions,
  TopicData,
  TopicMap,
  TypedSocketMessage,
} from '../schemas/socket'
import { cardClientActionSchema } from '../schemas/card'
import { configClientActionSchema } from '../schemas/config'
import { MessageTypes, Topics } from '../schemas/socket'

/**
 * Type-safe dispatcher for topic action handlers
 */
export function dispatchTopicAction<K extends Topic>(
  topic: K,
  payload: unknown,
  registry: TopicRegistry,
): Promise<TopicData<K>> {
  // Validate the payload shape first
  if (!isValidActionMessage(topic, payload)) {
    throw new Error('Invalid action payload')
  }

  // Now we can safely cast and dispatch
  return registry[topic].onAction(payload as TopicMap[K])
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

  const action = (payload as any).action

  // Additional validation logic based on topic
  if (topic === 'config') {
    return ['set', 'clear'].includes(action)
  }
  else if (topic === 'card') {
    return ['set', 'clear', 'hide', 'show', 'rotate', 'counterRotate', 'flip', 'turnOver'].includes(action)
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

/**
 * Type-safe function to convert a generic SocketMessage to a TypedSocketMessage
 * This helps with runtime type checking
 */
export function asTypedMessage(message: SocketMessage): TypedSocketMessage {
  return message as TypedSocketMessage
}

/**
 * Get all valid actions for a specific topic by extracting from schemas
 */
export function getTopicActions<T extends Topic>(topic: T): TopicActions<T>[] {
  // Extract actions directly from the schemas
  const schemaMap = {
    config: configClientActionSchema,
    card: cardClientActionSchema,
  }

  // Get the schema for this topic
  const schema = schemaMap[topic]

  // Extract values from the Zod enum schema
  return schema._def.values as TopicActions<T>[]
}
