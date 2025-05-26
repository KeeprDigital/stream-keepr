export type ConfigServerEvents = {
  connected: (config: TopicData<'config'>) => void
  sync: (config: TopicData<'config'>) => void
}

export type ConfigClientEvents = {
  set: (config: TopicData<'config'>) => void
}
