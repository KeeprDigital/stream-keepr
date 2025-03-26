export async function cardSubscribeHandler() {
  return await useStorage('local').getItem('card') as CardData | null
}

export async function cardMessageHandler(message: TopicMap['card']) {
  const localStorage = useStorage('local')

  if (message.action === 'set') {
    await localStorage.setItem('card', message.card)
    return message.card
  }

  const localCard = await localStorage.getItem<CardData>('card')

  if (!localCard) {
    return null
  }

  switch (message.action) {
    case 'hide':
      localCard.displayData.hidden = true
      break

    case 'show':
      localCard.displayData.hidden = false
      break

    case 'flip':
      localCard.displayData.flipped = !localCard.displayData.flipped
      break

    case 'rotate':
      localCard.displayData.rotated = !localCard.displayData.rotated
      break

    case 'counterRotate':
      localCard.displayData.counterRotated = !localCard.displayData.counterRotated
      break

    case 'turnOver':
      localCard.displayData.turnedOver = !localCard.displayData.turnedOver
      break

    case 'clear':
      await localStorage.removeItem('card')
      return null
  }

  await localStorage.setItem('card', localCard)
  return localCard
}
