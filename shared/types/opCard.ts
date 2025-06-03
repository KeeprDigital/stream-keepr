import type { z } from 'zod'
import type { opCardSchema } from '../schemas/opCard'

export type OpCardData = z.infer<typeof opCardSchema>

export type OpCardServerEvents = {
  connected: (card: TopicData<'opCard'> | null) => void
  sync: (card: TopicData<'opCard'> | null) => void
}

export type OpCardClientEvents = {
  set: (card: TopicData<'opCard'>) => void
  control: (action: OpActiveCardAction) => void
}

export type OpPreviewCardAction = 'show'
export type OpActiveCardAction = 'clear'
