export type EventServerEvents = {
  connected: (event: TopicData<'event'>) => void
  sync: (event: TopicData<'event'>) => void
}

export type EventClientEvents = {
  set: (event: TopicData<'event'>) => void
}
