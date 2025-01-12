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
  const cardPrintList = ref<CardData[]>([])
  const card = ref<SelectedCard>()
  const selectedFormat = ref<ScryfallFormat | 'all'>('all')

  const formatQuery = computed(() => selectedFormat.value === 'all'
    ? ''
    : `format:${selectedFormat.value}`)

  async function setCardImage() {
    await $fetch('/api/cardImage', {
      method: 'POST',
      body: {
        card: card.value,
      },
    })
  }

  async function selectCard(cardData: CardData) {
    loading.value = true
    card.value = {
      ...cardData,
      hidden: false,
      flipped: false,
      turnedOver: false,
      rotated: cardData.orientationData.defaultRotated,
      counterRotated: false,
      meldData: cardData.meldData,
    }
    await searchCardPrints()
    await setCardImage()
    loading.value = false
  }

  async function selectMeldCardPart(cardName: string) {
    loading.value = true
    const data = await $fetch<ScryfallCard.Any>('https://api.scryfall.com/cards/search', {
      query: {
        exact: cardName,
        unique: 'prints',
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

    await searchCardPrints()
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

    await $fetch<ScryfallList.Cards>('https://api.scryfall.com/cards/search', {
      query: {
        q: `${name} in:paper game:paper ${formatQuery.value}`,
        unique: 'cards',
      },
    }).then((data) => {
      if (!data) {
        cardList.value = []
        return
      }
      cardList.value = data.data.map(card => parseCard(card))
    }).catch(() => {
      cardList.value = []
      loading.value = false
    }).finally(() => {
      loading.value = false
    })
  }

  async function searchCardPrints() {
    loading.value = true
    await $fetch<ScryfallList.Cards>('https://api.scryfall.com/cards/search', {
      query: {
        q: `${card.value?.name} in:paper game:paper ${formatQuery.value}`,
        unique: 'prints',
      },
    }).then((data) => {
      cardPrintList.value = data.data.map(card => parseCard(card))
    }).catch(() => {
      cardPrintList.value = []
      loading.value = false
    }).finally(() => {
      loading.value = false
    })
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
    searchCardPrints,
    selectedFormat,
    cardPrintList,
    loading,
    cardNames,
    card,
    cardList,
  }
})
