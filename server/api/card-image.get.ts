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

  if (data.hidden) {
    return imageConfig
  }

  if (data.flipped) {
    image = data.imageData.front?.png ?? ''
    imageConfig.flippedImage = image
    return imageConfig
  }

  if (data.turnedOver) {
    image = data.imageData.back?.png ?? ''
  }
  else {
    image = data.imageData.front?.png ?? ''
  }

  if (data.rotated) {
    imageConfig.rotatedImage = image
  }
  else if (data.counterRotated) {
    imageConfig.counterRotatedImage = image
  }
  else {
    imageConfig.verticalImage = image
  }

  return imageConfig
})
