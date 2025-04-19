import { z } from 'zod'

export const eventDataSchema = z.object({
  currentRound: z.string(),
  leftTalent: z.string(),
  rightTalent: z.string(),
  holdingText: z.string(),
})
export type EventData = z.infer<typeof eventDataSchema>

export const eventClientActionSchema = z.enum([
  'set',
])
export type EventClientAction = z.infer<typeof eventClientActionSchema>

export const eventActionMessageSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    event: z.custom<EventData>(),
  }),
])
export type EventActionMessage = z.infer<typeof eventActionMessageSchema>

export const eventApiCallSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    event: z.object({
      test: z.string(),
    }),
  }),
])
export type EventApiCall = z.infer<typeof eventApiCallSchema>
