import  type { z } from 'zod/v4'
import type { playerDataSchema } from '../schemas/player'

export type PlayerData = z.infer<typeof playerDataSchema>
