import type { EventApiCall, EventData } from '~~/shared/schemas/event'
import type { TopicMap } from '~~/shared/schemas/socket'

export async function eventSubscribeHandler() {
  return await useStorage('local').getItem('event') as EventData | null
}

export async function eventApiCallHandler(_request: EventApiCall) {
  const localStorage = useStorage('local')
  const localEvent = await localStorage.getItem<EventData>('event')

  if (!localEvent) {
    return null
  }

  return localEvent
}

export async function eventHandler(message: TopicMap['event']) {
  if (message.action === 'set') {
    await useStorage('local').setItem('event', message.event)
    return message.event
  }
  return null
}
