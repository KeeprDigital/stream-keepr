/* eslint-disable ts/no-empty-object-type */
import type { EventNames } from '@socket.io/component-emitter'
import type { Namespace } from 'socket.io'
import type { Socket } from 'socket.io-client'

export const TopicNames = [
  'config',
  'mtgCard',
  'opCard',
  'matches',
  'event',
] as const
export type Topic = typeof TopicNames[number]

type TopicDataMap = {
  config: ConfigData
  mtgCard: MtgCardData
  opCard: OpCardData
  matches: MatchData[]
  event: EventData
}
export type TopicData<K extends Topic> = TopicDataMap[K]

// Base namespace
export type ServerEvents = {}
export type ClientEvents = {}
export type InterServerEvents = {}
export type SocketData = {}

// Server
type ServerEventsMap = {
  opCard: OpCardServerEvents
  mtgCard: MtgCardServerEvents
  event: EventServerEvents
  matches: MatchesServerEvents
  config: ConfigServerEvents
}
export type NameSpaceServerEvents<T extends Topic> = ServerEventsMap[T]
export type NameSpaceServerEventName<T extends Topic> = EventNames<NameSpaceServerEvents<T>>

type NameSpaceServerMap<T extends Topic> = {
  [K in Topic]: Namespace<NameSpaceClientEvents<T>, NameSpaceServerEvents<T>, {}, {}>
}
export type NameSpaceServer<T extends Topic> = NameSpaceServerMap<T>[T]

export type TopicServerEvents<TTopic extends Topic> = {
  [Event in NameSpaceServerEventName<TTopic>]: NameSpaceServerEvents<TTopic>[Event]
}

// Client
type ClientEventsMap = {
  opCard: OpCardClientEvents
  mtgCard: MtgCardClientEvents
  event: EventClientEvents
  matches: MatchClientEvents
  config: ConfigClientEvents
}
export type NameSpaceClientEvents<T extends Topic> = AddAckToActions<ClientEventsMap[T]>
export type NameSpaceClientEventName<T extends Topic> = EventNames<NameSpaceClientEvents<T>>

type NameSpaceClientMap<T extends Topic> = {
  [K in Topic]: Socket<NameSpaceServerEvents<T>, NameSpaceClientEvents<T>>
}
export type NameSpaceClient<T extends Topic> = NameSpaceClientMap<T>[T]

export type TopicClientEvents<TTopic extends Topic> = {
  [Event in NameSpaceClientEventName<TTopic>]: NameSpaceClientEvents<TTopic>[Event]
}
