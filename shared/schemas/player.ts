import { z } from 'zod'

export const playerDataSchema = z.object({
  name: z.string(),
  proNouns: z.string(),
  deck: z.string(),
  position: z.string(),
  score: z.object({
    wins: z.number(),
    losses: z.number(),
    draws: z.number(),
  }),
})
export type PlayerData = z.infer<typeof playerDataSchema>
