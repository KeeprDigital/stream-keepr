import  type { z } from 'zod/v4'
import type { configDataSchema, configOverlaySchema, configTalentSchema, configTournamentSchema } from '../schemas/config'

export type ConfigGame = z.infer<typeof configTournamentSchema.shape.game>
export type ConfigData = z.infer<typeof configDataSchema>
export type ConfigTournament = z.infer<typeof configTournamentSchema>
export type ConfigOverlay = z.infer<typeof configOverlaySchema>
export type ConfigTalent = z.infer<typeof configTalentSchema>

export type ConfigServerEvents = {
  connected: (config: TopicData<'config'>) => void
  sync: (config: TopicData<'config'>) => void
}

export type ConfigClientEvents = {
  set: (config: TopicData<'config'>) => void
}
