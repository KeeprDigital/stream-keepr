import type { CardApiCall, CardData } from '~~/shared/schemas/card'
import type { TopicMap } from '~~/shared/schemas/socket'

export async function cardSubscribeHandler(): Promise<CardData | null> {
  return await useStorage('local').getItem('card') as CardData | null
}

export async function cardApiCallHandler(_request: CardApiCall): Promise<CardData | null> {
  // TODO: Implement
  return null
}

export async function cardMessageHandler(message: TopicMap['card']): Promise<CardData | null> {
  const localStorage = useStorage('local')
  const card = await localStorage.getItem<CardData>('card')

  if (message.action === 'set') {
    await localStorage.setItem('card', message.card)
    return message.card
  }
  else if (message.action === 'clear') {
    await localStorage.removeItem('card')
    return null
  }

  if (!card) {
    return null
  }

  switch (message.action) {
    case 'hide':
      card.displayData.hidden = true
      break
    case 'show':
      card.displayData.hidden = false
      break
    case 'flip':
      card.displayData.flipped = !card.displayData.flipped
      break
    case 'rotate':
      card.displayData.rotated = !card.displayData.rotated
      break
    case 'counterRotate':
      card.displayData.counterRotated = !card.displayData.counterRotated
      break
    case 'turnOver':
      card.displayData.turnedOver = !card.displayData.turnedOver
      break
  }

  await localStorage.setItem('card', card)
  return card
}
