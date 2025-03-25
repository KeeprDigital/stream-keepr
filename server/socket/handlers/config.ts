export async function configHandler(message: TopicMap['config']) {
  if (message.action === 'set') {
    await useStorage('local').setItem('config', message.config)
  }
}

export async function configSubscribeHandler() {
  return await useStorage('local').getItem('config') as ConfigData | null
}
