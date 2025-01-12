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

  async function setCardImage() {
    await $fetch('/api/cardImage', {
      method: 'POST',
      body: {
        card: card.value,
      },
    })
  }

  async function selectCard(cardData: CardData) {
    card.value = {
      ...cardData,
      hidden: false,
      flipped: false,
      turnedOver: false,
      rotated: cardData.orientationData.defaultRotated,
      counterRotated: false,
      meldData: cardData.meldData,
    }
    await setCardImage()
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
      hidden: false,
      flipped: false,
      turnedOver: false,
      rotated: false,
      counterRotated: false,
    }

    loading.value = false
  }

  function clearSearch() {
    loading.value = false
    cardList.value = []
  }

  function clearCard() {
    card.value = undefined
    setCardImage()
  }

  function hideCard() {
    card.value!.hidden = true
    setCardImage()
  }

  function showCard() {
    card.value!.hidden = false
    setCardImage()
  }

  function rotateCard() {
    card.value!.rotated = !card.value!.rotated
    setCardImage()
  }

  function counterRotateCard() {
    card.value!.counterRotated = !card.value!.counterRotated
    setCardImage()
  }

  function flipCard() {
    card.value!.flipped = !card.value!.flipped
    setCardImage()
  }

  function turnOverCard() {
    card.value!.turnedOver = !card.value!.turnedOver
    setCardImage()
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
    setCardImage,
    selectCard,
    selectMeldCardPart,
    clearCard,
    hideCard,
    showCard,
    rotateCard,
    counterRotateCard,
    flipCard,
    turnOverCard,
    clearSearch,
    setSelectedFormat,
    selectedFormat,
    loading,
    cardNames,
    card,
    cardList,
  }
})
