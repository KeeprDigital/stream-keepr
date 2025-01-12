import type { SelectedCard } from '~/types/cardData'

export default defineEventHandler(async () => {
  const local = useStorage('local')
  const data = await local.getItem<SelectedCard>('cardData')

  const imageConfig = {
    verticalImage: '',
    rotatedImage: '',
    counterRotatedImage: '',
    flippedImage: '',
  }

  if (!data) {
    return imageConfig
  }

  let image = ''

  if (data.displayData.hidden) {
    return imageConfig
  }

  if (data.displayData.flipped) {
    image = data.imageData.front?.png ?? ''
    imageConfig.flippedImage = image
    return imageConfig
  }

  if (data.displayData.turnedOver) {
    image = data.imageData.back?.png ?? ''
  }
  else {
    image = data.imageData.front?.png ?? ''
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

  return imageConfig
})
