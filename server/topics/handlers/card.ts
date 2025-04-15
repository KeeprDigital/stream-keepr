import type { CardApiCall, CardData } from '~~/shared/schemas/card'
import type { TopicActions, TopicMap } from '~~/shared/schemas/socket'

async function handleCardAction(
  action: TopicActions<'card'>,
  card?: CardData,
): Promise<CardData | null> {
  const localStorage = useStorage('local')
  if (action === 'clear') {
    await localStorage.removeItem('card')
    return null
  }

  if (!card) {
    return null
  }

  if (action === 'set') {
    await localStorage.setItem('card', card)
    return card
  }

  switch (action) {
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

export async function cardSubscribeHandler(): Promise<CardData | null> {
  return await useStorage('local').getItem('card') as CardData | null
}

export async function cardApiCallHandler(request: CardApiCall): Promise<CardData | null> {
  return await handleCardAction(request.action)
}

export async function cardMessageHandler(message: TopicMap['card']): Promise<CardData | null> {
  if (message.action === 'set') {
    return await handleCardAction(message.action, message.card)
  }
  return await handleCardAction(message.action)
}
