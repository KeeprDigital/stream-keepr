import { z } from 'zod'

export const configTournamentSchema = z.object({
  game: z.enum(['mtg', 'op']),
  name: z.string(),
  description: z.string(),
  days: z.number(),
  swissRounds: z.number(),
  swissRoundTime: z.number(),
  cutRounds: z.number(),
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
