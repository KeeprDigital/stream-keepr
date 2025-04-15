import type { Topic, TopicApiCallMap, TopicData, TopicMap } from '~~/shared/schemas/socket'
import { cardApiCallHandler, cardMessageHandler, cardSubscribeHandler } from './handlers/card'
import { configApiCallHandler, configHandler, configSubscribeHandler } from './handlers/config'

export type TopicRegistry = {
  [K in Topic]: {
    description: string
    onSubscribe: () => Promise<TopicData<K>>
    onAction: (message: TopicMap[K]) => Promise<TopicData<K>>
    onApiCall: (request: TopicApiCallMap[K]) => Promise<TopicData<K>>
  }
}

export const topicRegistry: TopicRegistry = {
  config: {
    description: 'Configuration updates',
    onAction: configHandler,
    onSubscribe: configSubscribeHandler,
    onApiCall: configApiCallHandler,
  },
  card: {
    description: 'Card updates',
    onAction: cardMessageHandler,
    onSubscribe: cardSubscribeHandler,
    onApiCall: cardApiCallHandler,
  },
}
