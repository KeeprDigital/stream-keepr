import type { z } from 'zod/v4'
import type { configDataSchema } from '../schemas/config'

export type ConfigData = z.infer<typeof configDataSchema>

export type ConfigServerEvents = {
  connected: (config: TopicData<'config'>) => void
  sync: (config: TopicData<'config'>) => void
}

export type ConfigClientEvents = {
  set: (config: TopicData<'config'>) => void
}
