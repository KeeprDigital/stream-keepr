import type { Topic, TopicData, TopicMap } from '~~/shared/schemas/socket'
import { cardMessageHandler, cardSubscribeHandler } from './handlers/card'
import { configHandler, configSubscribeHandler } from './handlers/config'

export type TopicRegistry = {
  [K in Topic]: {
    description: string
    onSubscribe: () => Promise<TopicData<K>>
    onAction: (message: TopicMap[K]) => Promise<TopicData<K>>
  }
}

export const topicRegistry: TopicRegistry = {
  config: {
    description: 'Configuration updates',
    onAction: configHandler,
    onSubscribe: configSubscribeHandler,
  },
  card: {
    description: 'Card updates',
    onAction: cardMessageHandler,
    onSubscribe: cardSubscribeHandler,
  },
}
