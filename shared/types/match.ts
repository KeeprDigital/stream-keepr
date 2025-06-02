import type { z } from 'zod/v4'
import type { matchClockActionPayloadSchema, matchDataSchema } from '../schemas/match'

export type MatchData = z.infer<typeof matchDataSchema>

export type MatchesServerEvents = {
  connected: (match: TopicData<'matches'>) => void
  sync: (event: TopicData<'matches'>) => void
}

export type MatchClientEvents = {
  set: (match: TopicData<'matches'>[number]) => void
  add: () => void
  remove: (id: string) => void
  clock: (payload: MatchClockActionPayload) => void
}

export type ExtendMatchClientEvents = ExtendAckCallback<
  MatchClientEvents,
  {
    add: { matchId: string }
  }
>

export type MatchClockActionPayload = z.infer<typeof matchClockActionPayloadSchema>
export type MatchClockAction = MatchClockActionPayload['action']
