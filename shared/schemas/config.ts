import { z } from 'zod'

export const configDataSchema = z.object({
  name: z.string(),
  description: z.string(),
  days: z.number(),
  swissRounds: z.number(),
  cutRounds: z.number(),
  playerCount: z.number(),
  featureMatches: z.number(),
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

// Direct mapping of config actions to their payload types
export type ConfigActionPayloadMap = {
  set: { config: ConfigData }
  clear: Record<string, never>
}
