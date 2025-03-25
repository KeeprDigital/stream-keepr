import { cardMessageHandler, cardSubscribeHandler } from './handlers/card'
import { configHandler, configSubscribeHandler } from './handlers/config'

export type TopicRegistry<Topics extends Topic = Topic> = {
  [K in Topics]: {
    description: string
    onMessage: (message: TopicMap[K]) => Promise<void>
    onSubscribe: () => Promise<TopicData<K> | null>
  }
}
export const topicRegistry: TopicRegistry = {
  config: {
    description: 'Configuration updates',
    onMessage: configHandler,
    onSubscribe: configSubscribeHandler,
  },
  card: {
    description: 'Card updates',
    onMessage: cardMessageHandler,
    onSubscribe: cardSubscribeHandler,
  },
}
