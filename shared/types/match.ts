import type { z } from 'zod/v4'
import type { matchDataSchema } from '../schemas/match'

export type MatchData = z.infer<typeof matchDataSchema>

export type MatchesServerEvents = {
  connected: (match: TopicData<'matches'>) => void
  sync: (event: TopicData<'matches'>) => void
}

export type MatchClientEvents = {
  set: (
    match: TopicData<'matches'>[number],
    callback: (match: TopicData<'matches'>[number]) => void
  ) => void
  add: (
    callback: (match: TopicData<'matches'>[number]) => void
  ) => void
  remove: (
    id: string,
    callback: (matchId: string) => void
  ) => void
}
