import { z } from 'zod/v4'

export const configDataSchema = z.object({
  game: z.enum(['mtg', 'op']),
  name: z.string(),
  description: z.string(),
  matchOrientation: z.enum(['horizontal', 'vertical']),
  days: z.number(),
  swissRounds: z.number(),
  cutRounds: z.number(),
  playerCount: z.number(),
})
