import type { z } from 'zod'
import type { playerDataSchema } from '../schemas/player'

export type PlayerData = z.infer<typeof playerDataSchema>
