import type {
  ScryfallCard,
  ScryfallFormat,
  ScryfallList,
} from '@scryfall/api-types'
import type { CardData } from '~~/shared/schemas/card'
import { useStorage } from '@vueuse/core'

export const useCardStore = defineStore('Card', () => {
  const storeId = 'card-store'
  const socketStore = useSocket()
  const { publish } = socketStore
  const loading = ref(false)

  const cardList = ref<CardData[]>([])
  const cardPrintList = ref<CardData[]>([])

  const card = ref<CardData | null>(null)

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

  function init() {
    if (!socketStore.isSubscribed('card')) {
      socketStore.subscribe('card', storeId, handleSync, handleSubscribed)
    }
  }

  function handleSync(data: CardData | null) {
    card.value = data
    if (data) {
      searchCardPrints(data.name)
    }
  }

  function handleSubscribed(data: CardData | null) {
    if (data) {
      card.value = data
      searchCardPrints(data.name)
    }
  }

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
    publish('card', {
      action: 'set',
      card: cardData,
    })
  }

  async function selectCard(cardData: CardData, isPrinting: boolean = false) {
    loading.value = true

    const newCardData = {
      ...cardData,
      displayData: {
        hidden: !isPrinting,
        flipped: false,
        turnedOver: false,
        rotated: cardData.orientationData.defaultRotated,
        counterRotated: false,
      },
    }

    card.value = newCardData

    await searchCardPrints(cardData.name)
    await setCardImage(newCardData)

    pushToHistory(newCardData)

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
      displayData: {
        hidden: true,
        flipped: false,
        turnedOver: false,
        rotated: false,
        counterRotated: false,
      },
    }

    publish('card', {
      action: 'set',
      card: parsedCard,
    })

    await searchCardPrints(cardName)
    loading.value = false
  }

  function clearCard() {
    card.value = null
    publish('card', {
      action: 'clear',
    })
  }

  function hideCard() {
    card.value!.displayData.hidden = true
    publish('card', {
      action: 'hide',
    })
  }

  function showCard() {
    card.value!.displayData.hidden = false
    publish('card', {
      action: 'show',
    })
  }

  function rotateCard() {
    card.value!.displayData.rotated = !card.value!.displayData.rotated
    publish('card', {
      action: 'rotate',
    })
  }

  function counterRotateCard() {
    card.value!.displayData.counterRotated = !card.value!.displayData.counterRotated
    publish('card', {
      action: 'counterRotate',
    })
  }

  function flipCard() {
    card.value!.displayData.flipped = !card.value!.displayData.flipped
    publish('card', {
      action: 'flip',
    })
  }

  function turnOverCard() {
    card.value!.displayData.turnedOver = !card.value!.displayData.turnedOver
    publish('card', {
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

  init()

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
    loading,
    card,
    cardList,
    history,
  }
})
