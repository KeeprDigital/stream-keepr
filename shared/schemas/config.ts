import { z } from 'zod'

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

export const configClientActionSchema = z.enum([
  'set',
  'clear',
])
export type ConfigClientAction = z.infer<typeof configClientActionSchema>

export const configActionMessageSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    config: z.custom<ConfigData>(),
  }),
  z.object({ action: z.literal('clear') }),
])
export type ConfigActionMessage = z.infer<typeof configActionMessageSchema>

export const configApiCallSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    config: z.object({
      test: z.string(),
    }),
  }),
  z.object({ action: z.literal('clear') }),
])
export type ConfigApiCall = z.infer<typeof configApiCallSchema>
