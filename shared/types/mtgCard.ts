import type { z } from 'zod/v4'
import type { mtgCardDataSchema } from '../schemas/mtgCard'

export type MtgCardData = z.infer<typeof mtgCardDataSchema>

export type MtgCardServerEvents = {
  connected: (card: TopicData<'mtgCard'> | null) => void
  sync: (card: TopicData<'mtgCard'> | null) => void
}

export type MtgCardClientEvents = {
  set: (card: TopicData<'mtgCard'>) => void
  control: (action: MtgPreviewCardAction) => void
  clear: () => void
}

export type MtgActiveCardAction =
  | 'clear'

export type MtgPreviewCardAction =
  | 'show'
  | 'clear'
  | 'rotate'
  | 'counterRotate'
  | 'flip'
  | 'turnOver'
