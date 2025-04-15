import type { ConfigData } from '~~/shared/schemas/config'
import type { TopicMap } from '~~/shared/schemas/socket'

export async function configSubscribeHandler() {
  return await useStorage('local').getItem('config') as ConfigData | null
}

export async function configHandler(message: TopicMap['config']) {
  if (message.action === 'set') {
    await useStorage('local').setItem('config', message.config)
    return message.config
  }
  return null
}
