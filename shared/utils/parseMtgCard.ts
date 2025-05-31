import type { ScryfallCard } from '@scryfall/api-types'
import { defu } from 'defu'

export function parseMtgCard(card: ScryfallCard.Any): MtgCardData {
  const cardData = defu({
    name: card.name,
    set: card.set_name,
    layout: card.layout,
    points: pointsList.get(card.name) ?? 0,
  }, structuredClone(defaultMtgCardData))

  switch (card.layout) {
    case 'normal':
    case 'leveler':
    case 'class':
    case 'saga':
    case 'adventure':
    case 'mutate':
    case 'prototype':
    case 'planar':
    case 'scheme':
    case 'vanguard':
    case 'token':
    case 'emblem':
    case 'augment':
    case 'host':
      cardData.imageData.front = card.image_uris ?? null
      break

    case 'double_faced_token':
    case 'reversible_card':
    case 'art_series':
    case 'modal_dfc':
      return defu({
        imageData: {
          front: card.card_faces[0]?.image_uris ?? null,
          back: card.card_faces[1]?.image_uris ?? null,
        },
        orientationData: {
          turnable: true,
        },
      }, cardData)

    case 'transform':
      return defu({
        imageData: {
          front: card.card_faces[0]?.image_uris ?? null,
          back: card.card_faces[1]?.image_uris ?? null,
        },
        orientationData: {
          turnable: true,
        },
        displayData: {
          rotated: card.type_line.includes('Battle'),
        },
      }, cardData)

    case 'flip':
      return defu({
        imageData: {
          front: card.image_uris ?? null,
          back: null,
        },
        orientationData: {
          flipable: true,
        },
      }, cardData)

    case 'split':
      return defu({
        imageData: {
          front: card.image_uris ?? null,
          back: null,
        },
        orientationData: {
          counterRotateable: card.keywords?.includes('Aftermath'),
        },
      }, cardData)

    case 'meld': {
      const partOne = card.all_parts?.find(
        part => part.component === 'meld_part',
      )
      const partTwo = card.all_parts?.find(
        part => part.component === 'meld_part' && part.id !== partOne?.id,
      )
      const result = card.all_parts?.find(
        part => part.component === 'meld_result',
      )

      return defu({
        imageData: {
          front: card.image_uris ?? null,
          back: null,
        },
        meldData: {
          meldPartOne: partOne?.name ?? null,
          meldPartTwo: partTwo?.name ?? null,
          meldResult: result?.name ?? null,
        },
      }, cardData)
    }
  }

  return cardData
}
