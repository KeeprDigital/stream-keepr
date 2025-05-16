import { z } from 'zod'

export const opCardDisplayDataSchema = z.object({
  hidden: z.boolean(),
  timeoutStartTimestamp: z.number().optional(),
  timeoutDuration: z.number().optional(),
})
export type OpCardDisplayData = z.infer<typeof opCardDisplayDataSchema>

export const opCardSchema = z.object({
  id: z.string(),
  code: z.string(),
  rarity: z.string(),
  type: z.string(),
  name: z.string(),
  cost: z.number(),
  power: z.number().nullable(),
  counter: z.string().nullable(),
  color: z.string(),
  family: z.string(),
  ability: z.string(),
  trigger: z.string(),
  set_name: z.string(),
  image_url: z.string(),
  attribute_name: z.string(),
  displayData: opCardDisplayDataSchema.default({ hidden: true }),
})

export type OpCardData = z.infer<typeof opCardSchema>

export const opCardClientActionSchema = z.enum([
  'set',
  'clear',
  'hide',
  'show',
])
export type OpCardClientAction = z.infer<typeof opCardClientActionSchema>

export const opCardActionMessageSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    card: z.custom<OpCardData>(),
  }),
  z.object({ action: z.literal('clear') }),
  z.object({ action: z.literal('hide') }),
  z.object({ action: z.literal('show'), timeOut: z.number().optional() }),
])
export type OpCardActionMessage = z.infer<typeof opCardActionMessageSchema>

export const opCardApiCallSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), card: z.custom<OpCardData>() }),
  z.object({ action: z.literal('clear') }),
  z.object({ action: z.literal('hide') }),
  z.object({ action: z.literal('show'), timeOut: z.number().optional() }),
])
export type OpCardApiCall = z.infer<typeof opCardApiCallSchema>
