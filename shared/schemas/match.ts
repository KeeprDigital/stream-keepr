import { z } from 'zod'
import { playerDataSchema } from './player'

export const matchDataSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  tableNumber: z.string(),
  playerOne: playerDataSchema,
  playerTwo: playerDataSchema,
})
export type MatchData = z.infer<typeof matchDataSchema>

export const matchClockActionPayloadSchema = z.discriminatedUnion('action', [
  z.object({
    id: z.string(),
    action: z.enum(['start', 'stop', 'reset', 'pause', 'resume']),
    timestamp: z.number(),
    value: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    action: z.enum(['set', 'adjust']),
    timestamp: z.number(),
    value: z.number(),
  }),
])
