import { z } from 'zod'

export const eventDataSchema = z.object({
  currentRound: z.string(),
  leftTalent: z.string(),
  rightTalent: z.string(),
  holdingText: z.string(),
})
