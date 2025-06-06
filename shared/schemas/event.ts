import { z } from 'zod/v4'

export const eventDataSchema = z.object({
  currentDay: z.string(),
  currentRound: z.string(),
  leftTalent: z.string(),
  rightTalent: z.string(),
  holdingText: z.string(),
})
