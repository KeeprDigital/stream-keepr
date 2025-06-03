import { z } from 'zod'

export const sharedCardTimeoutDataSchema = z.object({
  timeoutStartTimestamp: z.number(),
  timeoutDuration: z.number(),
})
