/* eslint-disable ts/no-empty-object-type */
import type { Namespace } from 'socket.io'
import type { Socket } from 'socket.io-client'
import type { z } from 'zod/v4'
import type { configDataSchema } from '../schemas/config'
import type { eventDataSchema } from '../schemas/event'
import type { matchDataSchema } from '../schemas/match'
import type { mtgCardDataSchema } from '../schemas/mtgCard'
import type { opCardSchema } from '../schemas/opCard'
import type { playerDataSchema } from '../schemas/player'

export type PlayerData = z.infer<typeof playerDataSchema>
export type OpCardData = z.infer<typeof opCardSchema>
export type MtgCardData = z.infer<typeof mtgCardDataSchema>
export type MatchData = z.infer<typeof matchDataSchema>
export type EventData = z.infer<typeof eventDataSchema>
export type ConfigData = z.infer<typeof configDataSchema>

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
