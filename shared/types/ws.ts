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
 * Maps each topic to its corresponding custom client-side event interface.
 * Defines what events the client can emit for each topic.
 * These events have their acknowledgment callbacks specifically typed.
 */
export type ExtendedAckClientEventsMap = {
  matches: ExtendMatchClientEvents
  // Add other topics with custom responses here as needed
}

/**
 * Extracts and enhances the client events interface for a specific topic.
 * Uses custom events if defined, otherwise adds acknowledgment callbacks to action events.
 * @template T - The topic to get client events for
 */
export type NameSpaceClientEvents<T extends Topic> = T extends keyof ExtendedAckClientEventsMap
  ? AddAckToActions<ExtendedAckClientEventsMap[T]>
  : AddAckToActions<ClientEventsMap[T]>

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

/**
 * Utility type that extends specified methods in a base event interface to include acknowledgment callbacks.
 *
 * This type allows you to selectively transform methods in an event interface to accept an acknowledgment
 * callback as their parameter, while leaving other methods unchanged. This is particularly useful for
 * Socket.IO events where certain operations need to provide feedback to the client.
 *
 * @template TBase - The base event interface to extend
 * @template TExtensions - Object mapping method names to their acknowledgment data types.
 *                         Keys must be valid properties of TBase, values define the data structure
 *                         that the acknowledgment callback will receive.
 *
 * @example
 * ```typescript
 * type BaseEvents = {
 *   getMessage: (id: string) => void
 *   sendMessage: (content: string) => void
 *   deleteMessage: (id: string) => void
 * }
 *
 * type ExtendedEvents = ExtendAckCallback<BaseEvents, {
 *   sendMessage: { messageId: string; timestamp: Date }
 *   deleteMessage: { success: boolean }
 * }>
 *
 * // Result:
 * // {
 * //   getMessage: (id: string) => void
 * //   sendMessage: (ack: AckCallback<{ messageId: string; timestamp: Date }>) => void
 * //   deleteMessage: (ack: AckCallback<{ success: boolean }>) => void
 * // }
 * ```
 *
 * @example Socket.IO usage in this codebase:
 * ```typescript
 * type BaseMatchEvents = {
 *   joinMatch: (matchId: string) => void
 *   leaveMatch: () => void
 * }
 *
 * type MatchEvents = ExtendAckCallback<BaseMatchEvents, {
 *   joinMatch: { success: boolean; playerCount: number }
 * }>
 *
 * // Client can now emit with acknowledgment:
 * socket.emit('joinMatch', (ackData) => {
 *   console.log(`Join success: ${ackData.success}, Players: ${ackData.playerCount}`)
 * })
 * ```
 *
 * @see AckCallback - The callback function type used for acknowledgments
 * @see AddAckToActions - Related type that may use this utility for automatic event enhancement
 */
export type ExtendAckCallback<
  TBase,
  TExtensions extends Partial<Record<keyof TBase, any>>,
> = {
  [K in keyof TBase]: K extends keyof TExtensions
    ? (ack: AckCallback<TExtensions[K]>) => void
    : TBase[K]
}

/**
 * Extracts the response type for a specific event.
 * @template TTopic - The topic containing the event
 * @template TEvent - The specific event name within the topic
 * @example GetResponseType<'matches', 'add'> // Returns the response type for the add event
 */
export type GetResponseType<TTopic extends Topic, TEvent extends keyof ClientEventsMap[TTopic]> =
  TTopic extends keyof ExtendedAckClientEventsMap
    ? TEvent extends keyof ExtendedAckClientEventsMap[TTopic]
      ? ExtendedAckClientEventsMap[TTopic][TEvent] extends (ack: (response: infer R) => void) => void
        ? R
        : AckResponse
      : AckResponse
    : AckResponse
