import type { CardData } from '~~/shared/schemas/card'

export default defineEventHandler(async (event) => {
  const local = useStorage('local')
  const cardData = await local.getItem<CardData>('card')

  const emptyImage = `${getPublicAssetURL(event)}/Empty.png`

  const imageConfig = {
    verticalImage: emptyImage,
    rotatedImage: emptyImage,
    counterRotatedImage: emptyImage,
    flippedImage: emptyImage,
    points: '',
  }

  if (!cardData || cardData.displayData.hidden || !cardData.imageData.front?.png) {
    return [imageConfig]
  }

  if (cardData.points > 0) {
    imageConfig.points = `${cardData.points} ${cardData.points === 1 ? 'point' : 'points'}`
  }

  if (cardData.displayData.flipped) {
    imageConfig.flippedImage = cardData.imageData.front.png
    return [imageConfig]
  }

  if (cardData.displayData.rotated) {
    imageConfig.rotatedImage = cardData.imageData.front.png
    return [imageConfig]
  }

  if (cardData.displayData.counterRotated) {
    imageConfig.counterRotatedImage = cardData.imageData.front.png
    return [imageConfig]
  }

  if (cardData.displayData.turnedOver) {
    imageConfig.verticalImage = cardData.imageData.back?.png ?? emptyImage
    return [imageConfig]
  }

  imageConfig.verticalImage = cardData.imageData.front.png

  return [imageConfig]
})
