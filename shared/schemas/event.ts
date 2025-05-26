import { z } from 'zod/v4'

export const eventDataSchema = z.object({
  currentRound: z.string(),
  leftTalent: z.string(),
  rightTalent: z.string(),
  holdingText: z.string(),
})
