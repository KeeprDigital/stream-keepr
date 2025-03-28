import type { ScryfallCardFields, ScryfallImageUris } from '@scryfall/api-types'

export type CardData = {
  name: string
  set: string
  layout: ScryfallCardFields.Core.All['layout']
  imageData: CardImageData
  orientationData: CardOrientationData
  meldData?: CardMeldData
  points: number
  displayData: CardDisplayData
}

export type CardDisplayData = {
  hidden: boolean
  flipped: boolean
  rotated: boolean
  counterRotated: boolean
  turnedOver: boolean
}

export type CardImageData = {
  front: ScryfallImageUris | null
  back: ScryfallImageUris | null
}

export type CardOrientationData = {
  flipable: boolean
  turnable: boolean
  rotateable: boolean
  counterRotateable: boolean
  defaultRotated: boolean
}

export type CardMeldData = {
  meldPartOne: string | null
  meldPartTwo: string | null
  meldResult: string | null
}
