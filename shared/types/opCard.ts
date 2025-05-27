import type { z } from 'zod/v4'
import type { opCardSchema } from '../schemas/opCard'

export type OpCardData = z.infer<typeof opCardSchema>

export type OpCardServerEvents = {
  connected: (card: TopicData<'opCard'>) => void
  sync: (event: TopicData<'opCard'>) => void
}

export type OpCardClientEvents = {
  set: (card: TopicData<'opCard'>) => void
  hide: () => void
  show: () => void
  clear: () => void
}
