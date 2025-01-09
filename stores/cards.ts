import type {
  ScryfallCard,
  ScryfallFormat,
  ScryfallList,
} from '@scryfall/api-types'
import type { CardData, SelectedCard } from '~/types/cardData'

export const useCardsStore = defineStore('Cards', () => {
  const loading = ref(false)
  const cardNames = ref<string[]>([])
  const cardList = ref<CardData[]>([])
  const card = ref<SelectedCard>()
  const selectedFormat = ref<ScryfallFormat | 'all'>('all')

  async function selectCard(cardData: CardData) {
    loading.value = true
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

    loading.value = false
  }

  async function selectMeldCardPart(cardName: string) {
    loading.value = true
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

    loading.value = false
  }

  function clearSearch() {
    loading.value = false
    cardList.value = []
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

  function setSelectedFormat(format: ScryfallFormat | 'all') {
    selectedFormat.value = format
  }

  async function searchFuzzyCardName(name: string) {
    loading.value = true
    if (name.length < 3) {
      clearSearch()
      return
    }

    const formatQuery = selectedFormat.value === 'all' ? '' : `format:${selectedFormat.value}`

    const data = await $fetch<ScryfallList.Cards>('https://api.scryfall.com/cards/search', {
      query: {
        q: `${name} in:paper game:paper ${formatQuery}`,
        unique: 'cards',
      },
    }).catch(() => {
      cardList.value = []
      loading.value = false
    })

    if (!data) {
      cardList.value = []
      loading.value = false
      return
    }

    const parsedCards: CardData[] = []

    data.data.forEach((card) => {
      parsedCards.push(parseCard(card))
    })

    cardList.value = parsedCards
    loading.value = false
  }

  return {
    searchFuzzyCardName,
    selectCard,
    selectMeldCardPart,
    clearCard,
    hideCard,
    showCard,
    clearSearch,
    setSelectedFormat,
    selectedFormat,
    loading,
    cardNames,
    card,
    cardList,
  }
})
