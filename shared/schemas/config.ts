import { z } from 'zod/v4'

export const gameSchema = z.enum(['mtg', 'op'])
export type Game = z.infer<typeof gameSchema>

export const configDataSchema = z.object({
  game: gameSchema,
  name: z.string(),
  description: z.string(),
  days: z.number(),
  swissRounds: z.number(),
  cutRounds: z.number(),
  playerCount: z.number(),
})
export type ConfigData = z.infer<typeof configDataSchema>
