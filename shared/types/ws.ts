/* eslint-disable ts/no-empty-object-type */
import type { EventNames } from '@socket.io/component-emitter'
import type { Namespace } from 'socket.io'
import type { Socket } from 'socket.io-client'

/**
 * Array of all available topic names that can be used for Socket.IO namespaces.
 * These topics represent different functional areas of the application.
 */
export const TopicNames = [
  'config',
  'mtgCard',
  'opCard',
  'matches',
  'event',
] as const

/**
 * Union type representing all possible topic names.
 * Used to constrain generic parameters to valid topic values.
 */
export type Topic = typeof TopicNames[number]

/**
 * Maps each topic to its corresponding data type.
 * This ensures type safety when working with topic-specific data.
 */
type TopicDataMap = {
  config: ConfigData
  mtgCard: MtgCardData
  opCard: OpCardData
  matches: MatchData[]
  event: EventData
}

/**
 * Utility type to extract the data type for a specific topic.
 * @template K - The topic key to get data for
 * @example TopicData<'matches'> // Returns MatchData[]
 */
export type TopicData<K extends Topic> = TopicDataMap[K]

/**
 * Base interface for server-side Socket.IO events.
 * Can be extended to add common server events across all namespaces.
 */
export type ServerEvents = {}

/**
 * Base interface for client-side Socket.IO events.
 * Can be extended to add common client events across all namespaces.
 */
export type ClientEvents = {}

/**
 * Base interface for inter-server events in Socket.IO clusters.
 * Used for communication between multiple server instances.
 */
export type InterServerEvents = {}

/**
 * Base interface for data stored per socket connection.
 * Can be extended to add common socket data across all namespaces.
 */
export type SocketData = {}

/**
 * Function signature for handling Socket.IO namespace initialization.
 * @template T - The topic type for the namespace
 * @param namespace - The Socket.IO namespace instance for the given topic
 */
export type NamespaceHandler<T extends Topic> = (
  namespace: NameSpaceServer<T>
) => void

/**
 * Maps each topic to its corresponding server-side event interface.
 * Defines what events the server can emit for each topic.
 */
type ServerEventsMap = {
  opCard: OpCardServerEvents
  mtgCard: MtgCardServerEvents
  event: EventServerEvents
  matches: MatchesServerEvents
  config: ConfigServerEvents
}

/**
 * Extracts the server events interface for a specific topic.
 * @template T - The topic to get server events for
 */
export type NameSpaceServerEvents<T extends Topic> = ServerEventsMap[T]

/**
 * Extracts the event names that can be emitted by the server for a specific topic.
 * @template T - The topic to get server event names for
 */
export type NameSpaceServerEventName<T extends Topic> = EventNames<NameSpaceServerEvents<T>>

/**
 * Type representing a Socket.IO namespace on the server side for a specific topic.
 * @template T - The topic this namespace handles
 */
export type NameSpaceServer<T extends Topic> = Namespace<NameSpaceClientEvents<T>, NameSpaceServerEvents<T>, {}, {}>

/**
 * Maps each topic to its corresponding client-side event interface.
 * Defines what events the client can emit for each topic.
 */
export type ClientEventsMap = {
  opCard: OpCardClientEvents
  mtgCard: MtgCardClientEvents
  event: EventClientEvents
  matches: MatchClientEvents
  config: ConfigClientEvents
}

/**
 * Extracts and enhances the client events interface for a specific topic.
 * Automatically adds acknowledgment callbacks to action events.
 * @template T - The topic to get client events for
 */
export type NameSpaceClientEvents<T extends Topic> = AddAckToActions<ClientEventsMap[T]>

/**
 * Extracts the event names that can be emitted by the client for a specific topic.
 * @template T - The topic to get client event names for
 */
export type NameSpaceClientEventName<T extends Topic> = EventNames<NameSpaceClientEvents<T>>

/**
 * Type representing a Socket.IO client connection for a specific topic namespace.
 * @template T - The topic this client socket connects to
 */
export type NameSpaceClient<T extends Topic> = Socket<NameSpaceServerEvents<T>, NameSpaceClientEvents<T>>

/**
 * Utility type to extract the parameter types for a specific client event.
 * Useful for type-safe event emission and handling.
 * @template TTopic - The topic containing the event
 * @template E - The specific event name within the topic
 * @example ClientEventParams<'matches', 'joinMatch'> // Returns the parameters for joinMatch event
 */
export type ClientEventParams<TTopic extends Topic, E extends keyof ClientEventsMap[TTopic]> =
  ClientEventsMap[TTopic][E] extends (...args: infer P) => any ? P : never
