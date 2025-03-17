import type {
  ScryfallCard,
  ScryfallFormat,
  ScryfallList,
} from '@scryfall/api-types'
import { useStorage } from '@vueuse/core'

export const useCardStore = defineStore('Card', () => {
  const { send, incoming } = useWebSocketChannel('card')

  const loading = ref(false)

  const cardList = ref<CardData[]>([])
  const cardPrintList = ref<CardData[]>([])

  const card = ref<CardData | null>(null)
  const cardDisplay = ref<CardDisplayData>(initialCardDisplay())

  const selectedFormat = ref<MtgSet>('all')
  const history = useStorage<CardData[]>('card-history', [])

  const formatQuery = computed(() => {
    if (selectedFormat.value === 'all') {
      return ''
    }
    else if (selectedFormat.value === 'token') {
      return 'is:token'
    }
    else {
      return `format:${selectedFormat.value}`
    }
  })

  watch(incoming, (data) => {
    if (data) {
      card.value = data.card
      cardDisplay.value = data.display ?? initialCardDisplay()
      if (data.card) {
        searchCardPrints(data.card.name)
      }
    }
  }, {
    immediate: true,
  })

  /**
   * Fuzzy search for a card by name
   * @param name - The name of the card to search for
   */
  async function searchFuzzyCardName(name: string) {
    loading.value = true

    if (name.length < 3) {
      clearSearch()
      return
    }

    await $fetch<ScryfallList.Cards>('https://api.scryfall.com/cards/search', {
      query: {
        q: `${name} game:paper ${formatQuery.value}`,
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

  /**
   * Fetch all prints of a card
   * @param exactName - The exact name of the card to search for
   */
  async function searchCardPrints(exactName: string) {
    loading.value = true
    await $fetch<ScryfallList.Cards>('https://api.scryfall.com/cards/search', {
      query: {
        q: `${exactName} game:paper`,
        unique: 'prints',
        order: 'released',
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

  async function setCardImage(cardData: CardData) {
    send({
      action: 'set',
      card: cardData,
    })
  }

  async function selectCard(cardData: CardData, isPrinting: boolean = false) {
    loading.value = true

    card.value = {
      ...cardData,
    }

    cardDisplay.value = {
      hidden: !isPrinting,
      flipped: false,
      turnedOver: false,
      rotated: cardData.orientationData.defaultRotated,
      counterRotated: false,
    }

    await searchCardPrints(cardData.name)
    await setCardImage(cardData)

    pushToHistory(cardData)

    loading.value = false
  }

  function pushToHistory(cardData: CardData) {
    if (history.value.find(card => card.name === cardData.name)) {
      history.value.splice(history.value.indexOf(cardData), 1)
      history.value.push(cardData)
    }
    else {
      history.value.push(cardData)
    }
  }

  async function selectMeldCardPart(cardName: string) {
    loading.value = true
    const data = await $fetch<ScryfallCard.Any>('https://api.scryfall.com/cards/named', {
      query: {
        exact: cardName,
        unique: 'prints',
      },
    })

    const parsedCard = parseCard(data)

    card.value = {
      ...parsedCard,
    }

    cardDisplay.value = {
      hidden: true,
      flipped: false,
      turnedOver: false,
      rotated: false,
      counterRotated: false,
    }

    send({
      action: 'set',
      card: parsedCard,
    })

    await searchCardPrints(cardName)
    loading.value = false
  }

  function clearCard() {
    card.value = null
    send({
      action: 'clear',
    })
  }

  function hideCard() {
    cardDisplay.value.hidden = true
    send({
      action: 'hide',
    })
  }

  function showCard() {
    cardDisplay.value.hidden = false
    send({
      action: 'show',
    })
  }

  function rotateCard() {
    cardDisplay.value.rotated = !cardDisplay.value.rotated
    send({
      action: 'rotate',
    })
  }

  function counterRotateCard() {
    cardDisplay.value.counterRotated = !cardDisplay.value.counterRotated
    send({
      action: 'counterRotate',
    })
  }

  function flipCard() {
    cardDisplay.value.flipped = !cardDisplay.value.flipped
    send({
      action: 'flip',
    })
  }

  function turnOverCard() {
    cardDisplay.value.turnedOver = !cardDisplay.value.turnedOver
    send({
      action: 'turnOver',
    })
  }

  function clearSearch() {
    loading.value = false
    cardList.value = []
  }

  function clearHistory() {
    history.value = []
  }

  function setSelectedFormat(format: ScryfallFormat | 'all') {
    selectedFormat.value = format
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
    pushToHistory,
    clearHistory,
    searchCardPrints,
    selectedFormat,
    cardPrintList,
    cardDisplay,
    loading,
    card,
    cardList,
    history,
  }
})
