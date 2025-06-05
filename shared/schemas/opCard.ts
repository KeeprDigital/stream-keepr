import { z } from 'zod/v4'
import { sharedCardTimeoutDataSchema } from './shared'

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
  timeoutData: sharedCardTimeoutDataSchema.optional(),
})
