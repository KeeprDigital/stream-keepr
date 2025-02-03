import type {
  ScryfallCard,
  ScryfallFormat,
  ScryfallList,
} from '@scryfall/api-types'
import type { CardData, CardDisplayData } from '~/types/cardData'
import type { CardServerMessage } from '~/types/websocket'
import { useStorage } from '@vueuse/core'
import { createWebSocketMessage } from '~/types/websocket'

export const useCardsStore = defineStore('Cards', () => {
  const { data: serverCardData, send } = useWebSocket(`ws://${window.location.host}/api/ws`)
  const loading = ref(false)

  const cardList = ref<CardData[]>([])
  const cardPrintList = ref<CardData[]>([])

  const card = ref<CardData>()
  const cardDisplay = ref<CardDisplayData>(initialCardDisplay())

  const selectedFormat = ref<ScryfallFormat | 'all'>('all')
  const history = useStorage<CardData[]>('card-history', [])

  const formatQuery = computed(() => selectedFormat.value === 'all'
    ? ''
    : `format:${selectedFormat.value}`)

  watch(serverCardData, async (data) => {
    if (data) {
      const parsedData = JSON.parse(data) as CardServerMessage
      card.value = parsedData.payload.card
      cardDisplay.value = parsedData.payload.display
      await searchCardPrints(parsedData.payload.card.name)
    }
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

  /**
   * Fetch all prints of a card
   * @param exactName - The exact name of the card to search for
   */
  async function searchCardPrints(exactName: string) {
    loading.value = true
    await $fetch<ScryfallList.Cards>('https://api.scryfall.com/cards/search', {
      query: {
        q: `${exactName} in:paper game:paper`,
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
    send(createWebSocketMessage('card', {
      action: 'set',
      card: cardData,
    }))
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
    await searchCardPrints(cardName)
    loading.value = false
  }

  function clearCard() {
    card.value = undefined
    send(createWebSocketMessage('card', {
      action: 'clear',
    }))
  }

  function hideCard() {
    cardDisplay.value.hidden = true
    send(createWebSocketMessage('card', {
      action: 'hide',
    }))
  }

  function showCard() {
    cardDisplay.value.hidden = false
    send(createWebSocketMessage('card', {
      action: 'show',
    }))
  }

  function rotateCard() {
    cardDisplay.value.rotated = !cardDisplay.value.rotated
    send(createWebSocketMessage('card', {
      action: 'rotate',
    }))
  }

  function counterRotateCard() {
    cardDisplay.value.counterRotated = !cardDisplay.value.counterRotated
    send(createWebSocketMessage('card', {
      action: 'counterRotate',
    }))
  }

  function flipCard() {
    cardDisplay.value.flipped = !cardDisplay.value.flipped
    send(createWebSocketMessage('card', {
      action: 'flip',
    }))
  }

  function turnOverCard() {
    cardDisplay.value.turnedOver = !cardDisplay.value.turnedOver
    send(createWebSocketMessage('card', {
      action: 'turnOver',
    }))
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
