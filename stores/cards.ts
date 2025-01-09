import type {
  ScryfallCard,
  ScryfallList,
} from '@scryfall/api-types'
import type { CardData, SelectedCard } from '~/types/cardData'

export const useCardsStore = defineStore('Cards', () => {
  const cardNames = ref<string[]>([])
  const cardList = ref<CardData[]>([])
  const card = ref<SelectedCard>()

  async function selectCard(cardData: CardData) {
    const data = await $fetch<ScryfallCard.Any>('https://api.scryfall.com/cards/named', {
      query: {
        exact: cardData.name,
      },
    })

    card.value = {
      ...cardData,
      scryfallData: data,
      hidden: false,
      flipped: false,
      turnedOver: false,
      rotated: cardData.orientationData.defaultRotated,
      meldData: cardData.meldData,
    }
  }

  async function selectMeldCardPart(cardName: string) {
    const data = await $fetch<ScryfallCard.Any>('https://api.scryfall.com/cards/named', {
      query: {
        exact: cardName,
      },
    })

    const parsedCard = parseCard(data)

    card.value = {
      ...parsedCard,
      scryfallData: data,
      hidden: false,
      flipped: false,
      turnedOver: false,
      rotated: false,
    }
  }

  function clearCard() {
    card.value = undefined
  }

  function hideCard() {
    card.value!.hidden = true
  }

  function showCard() {
    card.value!.hidden = false
  }

  async function searchFuzzyCardName(name: string) {
    if (name.length < 3) {
      cardList.value = []
      return
    }

    const data = await $fetch<ScryfallList.Cards>('https://api.scryfall.com/cards/search', {
      query: {
        q: `${name} in:paper game:paper`,
        unique: 'cards',
        order: 'name',
      },
    }).catch(() => {
      cardList.value = []
    })

    if (!data) {
      cardList.value = []
      return
    }

    const parsedCards: CardData[] = []

    data.data.forEach((card) => {
      parsedCards.push(parseCard(card))
    })

    cardList.value = parsedCards
  }

  return {
    searchFuzzyCardName,
    selectCard,
    selectMeldCardPart,
    clearCard,
    hideCard,
    showCard,
    cardNames,
    card,
    cardList,
  }
})
