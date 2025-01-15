import type { SelectedCard } from '~/types/cardData'

export default defineEventHandler(async () => {
  const local = useStorage('local')
  const data = await local.getItem<SelectedCard>('cardData')

  const imageConfig = {
    verticalImage: 'https://upload.wikimedia.org/wikipedia/commons/5/59/Empty.png',
    rotatedImage: 'https://upload.wikimedia.org/wikipedia/commons/5/59/Empty.png',
    counterRotatedImage: 'https://upload.wikimedia.org/wikipedia/commons/5/59/Empty.png',
    flippedImage: 'https://upload.wikimedia.org/wikipedia/commons/5/59/Empty.png',
  }

  if (!data) {
    return [imageConfig]
  }

  let image = 'https://upload.wikimedia.org/wikipedia/commons/5/59/Empty.png'

  if (data.displayData.hidden) {
    return [imageConfig]
  }

  if (data.displayData.flipped) {
    image = data.imageData.front?.png ?? 'https://upload.wikimedia.org/wikipedia/commons/5/59/Empty.png'
    imageConfig.flippedImage = image
    return [imageConfig]
  }

  if (data.displayData.turnedOver) {
    image = data.imageData.back?.png ?? 'https://upload.wikimedia.org/wikipedia/commons/5/59/Empty.png'
  }
  else {
    image = data.imageData.front?.png ?? 'https://upload.wikimedia.org/wikipedia/commons/5/59/Empty.png'
  }

  if (data.displayData.rotated) {
    imageConfig.rotatedImage = image
  }
  else if (data.displayData.counterRotated) {
    imageConfig.counterRotatedImage = image
  }
  else {
    imageConfig.verticalImage = image
  }

  return [imageConfig]
})
