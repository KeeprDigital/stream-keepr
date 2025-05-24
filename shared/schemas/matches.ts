import { z } from 'zod/v4'
import { playerDataSchema } from './player'

export const matchDataSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  tableNumber: z.string(),
  playerOne: playerDataSchema,
  playerTwo: playerDataSchema,
})
export type MatchData = z.infer<typeof matchDataSchema>

export const matchDataListSchema = z.array(matchDataSchema)
export type MatchDataList = z.infer<typeof matchDataListSchema>
