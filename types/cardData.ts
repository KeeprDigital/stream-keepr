import type { ScryfallCard, ScryfallCardFields, ScryfallImageUris } from '@scryfall/api-types'

export type SelectedCard = {
  name: string
  layout: ScryfallCardFields.Core.All['layout']
  imageData: CardImageData
  orientationData: CardOrientationData
  meldData?: CardMeldData
  hidden: boolean
  flipped: boolean
  rotated: boolean
  counterRotated: boolean
  turnedOver: boolean
}

export type CardData = {
  name: string
  layout: ScryfallCardFields.Core.All['layout']
  imageData: CardImageData
  orientationData: CardOrientationData
  meldData?: CardMeldData
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
