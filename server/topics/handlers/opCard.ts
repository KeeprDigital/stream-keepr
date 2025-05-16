import type { OpCardApiCall, OpCardData } from '~~/shared/schemas/opCard'
import type { TopicMap } from '~~/shared/schemas/socket'
import { publishMessage } from '../../api/socket'

export async function opCardSubscribeHandler(): Promise<OpCardData | null> {
  return await useStorage('local').getItem('opCard') as OpCardData | null
}

export async function opCardApiCallHandler(_request: OpCardApiCall): Promise<OpCardData | null> {
  // TODO: Implement
  return null
}

export async function opCardMessageHandler(message: TopicMap['opCard']): Promise<OpCardData | null> {
  const localStorage = useStorage('local')
  const opCardStateInHandler = await localStorage.getItem<OpCardData>('opCard')

  if (message.action === 'set') {
    await localStorage.setItem('opCard', message.card)
    return message.card
  }
  else if (message.action === 'clear') {
    await localStorage.removeItem('opCard')
    return null
  }

  if (!opCardStateInHandler) {
    return null
  }

  switch (message.action) {
    case 'hide':
      if (!opCardStateInHandler)
        return null
      opCardStateInHandler.displayData.hidden = true
      opCardStateInHandler.displayData.timeoutStartTimestamp = undefined
      opCardStateInHandler.displayData.timeoutDuration = undefined
      break
    case 'show': {
      if (!opCardStateInHandler)
        return null
      opCardStateInHandler.displayData.hidden = false
      const opCardNameForTimeout = opCardStateInHandler.name
      const timeoutInSeconds = message.timeOut

      if (timeoutInSeconds && timeoutInSeconds > 0) {
        opCardStateInHandler.displayData.timeoutStartTimestamp = Date.now()
        opCardStateInHandler.displayData.timeoutDuration = timeoutInSeconds * 1000

        setTimeout(async () => {
          const currentOpCardInStorage = await localStorage.getItem<OpCardData>('opCard')
          if (currentOpCardInStorage
            && currentOpCardInStorage.name === opCardNameForTimeout
            && !currentOpCardInStorage.displayData.hidden
            // Verify that the timeout hasn't been superseded by a new one or cleared
            && currentOpCardInStorage.displayData.timeoutStartTimestamp === opCardStateInHandler.displayData.timeoutStartTimestamp) {
            currentOpCardInStorage.displayData.hidden = true
            currentOpCardInStorage.displayData.timeoutStartTimestamp = undefined
            currentOpCardInStorage.displayData.timeoutDuration = undefined
            await localStorage.setItem('opCard', currentOpCardInStorage)
            publishMessage('opCard', currentOpCardInStorage)
          }
        }, timeoutInSeconds * 1000)
      }
      else {
        // If no timeout or timeout is 0, clear any existing timeout fields
        opCardStateInHandler.displayData.timeoutStartTimestamp = undefined
        opCardStateInHandler.displayData.timeoutDuration = undefined
      }
      break
    }
  }

  if (opCardStateInHandler) {
    await localStorage.setItem('opCard', opCardStateInHandler)
  }
  return opCardStateInHandler
}
