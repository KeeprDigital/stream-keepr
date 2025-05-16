import type { CardApiCall, CardData } from '~~/shared/schemas/mtgCard'
import type { TopicMap } from '~~/shared/schemas/socket'
import { publishMessage } from '../../api/socket'

export async function cardSubscribeHandler(): Promise<CardData | null> {
  return await useStorage('local').getItem('card') as CardData | null
}

export async function cardApiCallHandler(_request: CardApiCall): Promise<CardData | null> {
  // TODO: Implement
  return null
}

export async function cardMessageHandler(message: TopicMap['card']): Promise<CardData | null> {
  const localStorage = useStorage('local')
  const cardStateInHandler = await localStorage.getItem<CardData>('card')

  if (message.action === 'set') {
    await localStorage.setItem('card', message.card)
    return message.card
  }
  else if (message.action === 'clear') {
    await localStorage.removeItem('card')
    return null
  }

  if (!cardStateInHandler) {
    return null
  }

  switch (message.action) {
    case 'hide':
      if (!cardStateInHandler)
        return null
      cardStateInHandler.displayData.hidden = true
      cardStateInHandler.displayData.timeoutStartTimestamp = undefined
      cardStateInHandler.displayData.timeoutDuration = undefined
      break
    case 'show': {
      if (!cardStateInHandler)
        return null
      cardStateInHandler.displayData.hidden = false
      const cardNameForTimeout = cardStateInHandler.name
      const timeoutInSeconds = message.timeOut

      if (timeoutInSeconds && timeoutInSeconds > 0) {
        cardStateInHandler.displayData.timeoutStartTimestamp = Date.now()
        cardStateInHandler.displayData.timeoutDuration = timeoutInSeconds * 1000

        setTimeout(async () => {
          const currentCardInStorage = await localStorage.getItem<CardData>('card')
          if (currentCardInStorage
            && currentCardInStorage.name === cardNameForTimeout
            && !currentCardInStorage.displayData.hidden
            // Verify that the timeout hasn't been superseded by a new one or cleared
            && currentCardInStorage.displayData.timeoutStartTimestamp === cardStateInHandler.displayData.timeoutStartTimestamp) {
            currentCardInStorage.displayData.hidden = true
            currentCardInStorage.displayData.timeoutStartTimestamp = undefined
            currentCardInStorage.displayData.timeoutDuration = undefined
            await localStorage.setItem('card', currentCardInStorage)
            publishMessage('card', currentCardInStorage)
          }
        }, timeoutInSeconds * 1000)
      }
      else {
        // If no timeout or timeout is 0, clear any existing timeout fields
        cardStateInHandler.displayData.timeoutStartTimestamp = undefined
        cardStateInHandler.displayData.timeoutDuration = undefined
      }
      break
    }
    case 'flip':
      if (!cardStateInHandler)
        return null
      cardStateInHandler.displayData.flipped = !cardStateInHandler.displayData.flipped
      break
    case 'rotate':
      if (!cardStateInHandler)
        return null
      cardStateInHandler.displayData.rotated = !cardStateInHandler.displayData.rotated
      break
    case 'counterRotate':
      if (!cardStateInHandler)
        return null
      cardStateInHandler.displayData.counterRotated = !cardStateInHandler.displayData.counterRotated
      break
    case 'turnOver':
      if (!cardStateInHandler)
        return null
      cardStateInHandler.displayData.turnedOver = !cardStateInHandler.displayData.turnedOver
      break
  }

  if (cardStateInHandler) {
    await localStorage.setItem('card', cardStateInHandler)
  }
  return cardStateInHandler
}
