import type { ScryfallCard } from '@scryfall/api-types'
import type { CardData } from '../schemas/card'

export function parseCard(card: ScryfallCard.Any): CardData {
  const cardData: CardData = {
    name: card.name,
    set: card.set_name,
    layout: card.layout,
    imageData: {
      front: null,
      back: null,
    },
    displayData: {
      hidden: true,
      flipped: false,
      turnedOver: false,
      rotated: false,
      counterRotated: false,
    },
    orientationData: {
      flipable: false,
      turnable: false,
      rotateable: false,
      counterRotateable: false,
      defaultRotated: false,
    },
    points: pointsList.get(card.name) ?? 0,
  }

  switch (card.layout) {
    case 'double_faced_token':
    case 'reversible_card':
    case 'art_series':
    case 'modal_dfc':
      cardData.imageData = {
        front: card.card_faces[0]?.image_uris ?? null,
        back: card.card_faces[1]?.image_uris ?? null,
      }
      cardData.orientationData = {
        flipable: false,
        turnable: true,
        rotateable: false,
        counterRotateable: false,
        defaultRotated: false,
      }
      break

    case 'transform':
      cardData.imageData = {
        front: card.card_faces[0]?.image_uris ?? null,
        back: card.card_faces[1]?.image_uris ?? null,
      }

      if (card.type_line.includes('Battle')) {
        cardData.orientationData = {
          flipable: false,
          turnable: true,
          rotateable: false,
          counterRotateable: false,
          defaultRotated: true,
        }
      }
      else {
        cardData.orientationData = {
          flipable: false,
          turnable: true,
          rotateable: false,
          counterRotateable: false,
          defaultRotated: false,
        }
      }
      break

    case 'flip':
      cardData.imageData = {
        front: card.image_uris ?? null,
        back: null,
      }
      cardData.orientationData = {
        flipable: true,
        turnable: false,
        rotateable: false,
        counterRotateable: false,
        defaultRotated: false,
      }
      break

    case 'split':
      cardData.imageData = {
        front: card.image_uris ?? null,
        back: null,
      }
      if (card.keywords?.includes('Aftermath')) {
        cardData.orientationData = {
          flipable: false,
          turnable: false,
          rotateable: false,
          counterRotateable: true,
          defaultRotated: false,
        }
      }
      else {
        cardData.orientationData = {
          flipable: false,
          turnable: false,
          rotateable: false,
          counterRotateable: false,
          defaultRotated: true,
        }
      }
      break

    case 'meld': {
      cardData.imageData = {
        front: card.image_uris ?? null,
        back: null,
      }
      cardData.orientationData = {
        flipable: false,
        turnable: false,
        rotateable: false,
        counterRotateable: false,
        defaultRotated: false,
      }

      const partOne = card.all_parts?.find(
        part => part.component === 'meld_part',
      )
      const partTwo = card.all_parts?.find(
        part => part.component === 'meld_part'
          && part.id !== partOne?.id,
      )
      const result = card.all_parts?.find(
        part => part.component === 'meld_result',
      )

      cardData.meldData = {
        meldPartOne: partOne?.name ?? null,
        meldPartTwo: partTwo?.name ?? null,
        meldResult: result?.name ?? null,
      }
    }
      break

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
      cardData.imageData = {
        front: card.image_uris ?? null,
        back: null,
      }
      break

    default:
      cardData.imageData = {
        front: null,
        back: null,
      }
  }
  return cardData
}
