import { z } from 'zod/v4'
import { playerDataSchema } from './player'

export const matchClockSchema = z.object({
  running: z.boolean(),
  totalDuration: z.number(),
  elapsedTime: z.number(),
  startTime: z.number().nullable(),
  mode: z.enum(['countdown', 'countup']),
  initialDuration: z.number(),
})

export const matchDataSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  tableNumber: z.string().optional(),
  playerOne: playerDataSchema,
  playerTwo: playerDataSchema,
  clock: matchClockSchema.optional(),
})

export const matchClockActionPayloadSchema = z.discriminatedUnion('action', [
  z.object({
    id: z.string(),
    action: z.enum(['start', 'reset', 'pause', 'resume']),
  }),
  z.object({
    id: z.string(),
    action: z.enum(['set', 'adjust']),
    value: z.number(),
  }),
  z.object({
    id: z.string(),
    action: z.enum(['setMode']),
    mode: z.enum(['countdown', 'countup']),
  }),
])
