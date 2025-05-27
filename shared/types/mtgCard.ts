import type { z } from 'zod/v4'
import type { mtgCardDataSchema } from '../schemas/mtgCard'

export type MtgCardData = z.infer<typeof mtgCardDataSchema>

export type MtgCardServerEvents = {
  connected: (card: TopicData<'mtgCard'>) => void
  sync: (event: TopicData<'mtgCard'>) => void
}

export type MtgCardClientEvents = {
  set: (card: TopicData<'mtgCard'>) => void
  clear: () => void
  show: (timeOut?: number) => void
  hide: () => void
  rotate: () => void
  counterRotate: () => void
  flip: () => void
  turnOver: () => void
}
