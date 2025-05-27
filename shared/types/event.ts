import type { z } from 'zod/v4'
import type { eventDataSchema } from '../schemas/event'

export type EventData = z.infer<typeof eventDataSchema>

export type EventServerEvents = {
  connected: (event: TopicData<'event'>) => void
  sync: (event: TopicData<'event'>) => void
}

export type EventClientEvents = {
  set: (event: TopicData<'event'>) => void
  clear: () => void
}
