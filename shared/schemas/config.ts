import { z } from 'zod/v4'

export const configTournamentSchema = z.object({
  game: z.enum(['mtg', 'op']),
  name: z.string(),
  description: z.string(),
  days: z.number(),
  eventMode: z.enum(['manual', 'tournament']),
  defaultClockDuration: z.number().min(0),
  defaultClockMode: z.enum(['countdown', 'countup']),
  swissRounds: z.number().min(1, 'Must have at least 1 Swiss round'),
  swissRoundTime: z.number(),
  cutRounds: z.number().min(0),
  cutRoundTime: z.number(),
  playerCount: z.number(),
})

export const configOverlaySchema = z.object({
  matchOrientation: z.enum(['horizontal', 'vertical']),
  cardTimeout: z.number(),
  cardSize: z.number(),
  clearPreviewOnShow: z.boolean(),
})

export const talentSchema = z.object({
  name: z.string(),
})

export const configTalentSchema = z.object({
  talents: z.array(talentSchema),
})

export const configDataSchema = z.object({
  tournament: configTournamentSchema,
  overlay: configOverlaySchema,
  talent: configTalentSchema,
})
