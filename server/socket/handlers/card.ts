export async function cardMessageHandler(message: TopicMap['card']) {
  if (message.action === 'set') {
    await useStorage('local').setItem('card', message.card)
  }
}

export async function cardSubscribeHandler() {
  return await useStorage('local').getItem('card') as CardData | null
}
