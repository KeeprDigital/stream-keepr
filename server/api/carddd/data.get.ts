import type { CardData, CardDisplayData } from '~~/shared/schemas/card'

export default defineEventHandler(async (event) => {
  const local = useStorage('local')
  const data = await local.getItem<CardData>('card')
  const display = await local.getItem<CardDisplayData>('cardDisplay')

  const emptyImage = `${getPublicAssetURL(event)}/Empty.png`

  const imageConfig = {
    verticalImage: emptyImage,
    rotatedImage: emptyImage,
    counterRotatedImage: emptyImage,
    flippedImage: emptyImage,
    points: '',
  }

  if (!data || !display || display.hidden) {
    return [imageConfig]
  }

  if (data.points > 0) {
    imageConfig.points = `${data.points} ${data.points === 1 ? 'point' : 'points'}`
  }

  if (display.flipped) {
    if (data.imageData.front?.png) {
      imageConfig.flippedImage = data.imageData.front.png
    }
    return [imageConfig]
  }

  if (display.turnedOver) {
    if (data.imageData.back?.png) {
      imageConfig.verticalImage = data.imageData.back.png
    }
    return [imageConfig]
  }

  if (display.rotated) {
    if (data.imageData.front?.png) {
      imageConfig.rotatedImage = data.imageData.front.png
    }
  }
  else if (display.counterRotated) {
    if (data.imageData.back?.png) {
      imageConfig.counterRotatedImage = data.imageData.back.png
    }
  }
  else {
    if (data.imageData.front?.png) {
      imageConfig.verticalImage = data.imageData.front.png
    }
  }

  return [imageConfig]
})
