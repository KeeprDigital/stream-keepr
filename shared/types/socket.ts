/* eslint-disable ts/no-empty-object-type */
import type { Namespace } from 'socket.io'
import type { Socket } from 'socket.io-client'
import type { ConfigData } from '../schemas/config'
import type { EventData } from '../schemas/event'
import type { MatchDataList } from '../schemas/matches'
import type { MtgCardData } from '../schemas/mtgCard'
import type { OpCardData } from '../schemas/opCard'

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
  matches: MatchDataList
  event: EventData
}
export type TopicData<K extends Topic> = TopicDataMap[K]

// Base namespace
export type ServerEvents = {}
export type ClientEvents = {}
export type InterServerEvents = {}
export type SocketData = {}

// OpCard namespace
export type OpCardServerEvents<T extends Topic = 'opCard'> = {
  connected: (card: TopicData<T> | null) => void
  sync: (event: TopicData<T>) => void
}
export type OpCardClientEvents<T extends Topic = 'opCard'> = {
  set: (card: TopicData<T>) => void
  hide: () => void
  show: () => void
  clear: () => void
}

// MtgCard Namespace
export type MtgCardServerEvents<T extends Topic = 'mtgCard'> = {
  connected: (card: TopicData<T> | null) => void
  sync: (event: TopicData<T>) => void
}
export type MtgCardClientEvents<T extends Topic = 'mtgCard'> = {
  set: (card: TopicData<T>) => void
  clear: () => void
  show: (timeOut?: number) => void
  hide: () => void
  rotate: () => void
  counterRotate: () => void
  flip: () => void
  turnOver: () => void
}

// Event namespace
export type EventServerEvents<T extends Topic = 'event'> = {
  connected: (event: TopicData<T>) => void
  sync: (event: TopicData<T>) => void
}
export type EventClientEvents<T extends Topic = 'event'> = {
  set: (event: TopicData<T>) => void
}

// Match namespace
export type MatchesServerEvents<T extends Topic = 'matches'> = {
  connected: (match: TopicData<T> | null) => void
  sync: (event: TopicData<T>) => void
}
export type MatchClientEvents<T extends Topic = 'matches'> = {
  set: (match: TopicData<T>) => void
  add: () => void
  remove: (id: string) => void
}

// Config namespace
export type ConfigServerEvents<T extends Topic = 'config'> = {
  connected: (config: TopicData<T> | null) => void
  sync: (config: TopicData<T>) => void
}
export type ConfigClientEvents<T extends Topic = 'config'> = {
  set: (config: TopicData<T>) => void
}

// Server
type ServerEventsMap = {
  opCard: OpCardServerEvents
  mtgCard: MtgCardServerEvents
  event: EventServerEvents
  matches: MatchesServerEvents
  config: ConfigServerEvents
}
export type NameSpaceServerEvents<T extends Topic> = ServerEventsMap[T]
export type NameSpaceServerEventName<T extends Topic> = keyof NameSpaceServerEvents<T>

type NameSpaceServerMap<T extends Topic> = {
  [K in Topic]: Namespace<NameSpaceClientEvents<T>, NameSpaceServerEvents<T>, {}, {}>
}
export type NameSpaceServer<T extends Topic> = NameSpaceServerMap<T>[T]

// Client
type ClientEventsMap = {
  opCard: OpCardClientEvents
  mtgCard: MtgCardClientEvents
  event: EventClientEvents
  matches: MatchClientEvents
  config: ConfigClientEvents
}
export type NameSpaceClientEvents<T extends Topic> = ClientEventsMap[T]

type NameSpaceClientMap<T extends Topic> = {
  [K in Topic]: Socket<NameSpaceServerEvents<T>, NameSpaceClientEvents<T>>
}
export type NameSpaceClient<T extends Topic> = NameSpaceClientMap<T>[T]

export type TopicActions<TTopic extends Topic> = { [Event in NameSpaceServerEventName<TTopic>]: NameSpaceServerEvents<TTopic>[Event] }
