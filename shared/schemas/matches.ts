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

export const matchDataListSchema = z.array(matchDataSchema)
export type MatchDataList = z.infer<typeof matchDataListSchema>

export const matchClientActionSchema = z.enum([
  'add',
  'remove',
  'set',
])
export type MatchClientAction = z.infer<typeof matchClientActionSchema>

export const matchActionMessageSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal(matchClientActionSchema.enum.add),
  }),
  z.object({
    action: z.literal(matchClientActionSchema.enum.remove),
    id: z.string(),
  }),
  z.object({
    action: z.literal(matchClientActionSchema.enum.set),
    match: matchDataSchema,
  }),
])
export type MatchActionMessage = z.infer<typeof matchActionMessageSchema>

export const matchApiCallSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal(matchClientActionSchema.enum.add),
  }),
  z.object({
    action: z.literal(matchClientActionSchema.enum.remove),
    index: z.number(),
  }),
  z.object({
    action: z.literal(matchClientActionSchema.enum.set),
    index: z.number(),
    tableNumber: z.string(),
    playerOne: playerDataSchema,
    playerTwo: playerDataSchema,
  }),
])
export type MatchApiCall = z.infer<typeof matchApiCallSchema>
