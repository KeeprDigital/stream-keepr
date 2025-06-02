import { z } from 'zod/v4'

export const sharedCardTimeoutDataSchema = z.object({
  timeoutStartTimestamp: z.number(),
  timeoutDuration: z.number(),
})
