export type OpCardServerEvents = {
  connected: (card: TopicData<'opCard'>) => void
  sync: (event: TopicData<'opCard'>) => void
}

export type OpCardClientEvents = {
  set: (card: TopicData<'opCard'>) => void
  hide: () => void
  show: () => void
  clear: () => void
}
