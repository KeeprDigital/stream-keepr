import { z } from 'zod'

export const eventSchema = z.object({
  name: z.string().optional(),
  currentRound: z.string().optional(),
  leftTalent: z.string().optional(),
  rightTalent: z.string().optional(),
  holdingText: z.string().optional(),
})
export type Event = z.output<typeof eventSchema>

export const playerSchema = z.object({
  name: z.string(),
  proNouns: z.string(),
  deck: z.string(),
  position: z.string(),
  score: z.object({
    wins: z.number().default(0),
    losses: z.number().default(0),
    draws: z.number().default(0),
  }),
})

export type Player = z.output<typeof playerSchema>

export type OverlayState = {
  topPlayer: Player
  bottomPlayer: Player
  event: Event
}
