import type { z } from 'zod/v4'
import type { opCardSchema } from '../schemas/opCard'

export type OpCardData = z.infer<typeof opCardSchema>

export type OpCardServerEvents = {
  connected: (card: TopicData<'opCard'> | null) => void
  sync: (card: TopicData<'opCard'> | null) => void
}

export type OpCardClientEvents = {
  set: (card: TopicData<'opCard'>) => void
  hide: () => void
  show: (timeout: number) => void
  clear: () => void
}
