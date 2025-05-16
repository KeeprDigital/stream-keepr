import type { Topic, TopicApiCallMap, TopicData, TopicMap } from '~~/shared/schemas/socket'
import { cardApiCallHandler, cardMessageHandler, cardSubscribeHandler } from './handlers/card'
import { configApiCallHandler, configHandler, configSubscribeHandler } from './handlers/config'
import { eventApiCallHandler, eventHandler, eventSubscribeHandler } from './handlers/event'
import { matchApiCallHandler, matchHandler, matchSubscribeHandler } from './handlers/matches'
import { opCardApiCallHandler, opCardMessageHandler, opCardSubscribeHandler } from './handlers/opCard'

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
  opCard: {
    description: 'OpCard updates',
    onAction: opCardMessageHandler,
    onSubscribe: opCardSubscribeHandler,
    onApiCall: opCardApiCallHandler,
  },
  matches: {
    description: 'Match updates',
    onAction: matchHandler,
    onSubscribe: matchSubscribeHandler,
    onApiCall: matchApiCallHandler,
  },
  event: {
    description: 'Event updates',
    onAction: eventHandler,
    onSubscribe: eventSubscribeHandler,
    onApiCall: eventApiCallHandler,
  },
}
