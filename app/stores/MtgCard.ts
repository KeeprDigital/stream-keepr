import type {
  ScryfallCard,
  ScryfallFormat,
  ScryfallList,
} from '@scryfall/api-types'
import { useCountdown, useStorage } from '@vueuse/core'

export const useMtgCardStore = defineStore('MtgCard', () => {
  const history = useStorage<MtgCardData[]>('mtgCard-history', [])

  const { start, reset, remaining, isActive } = useCountdown(0)

  const loading = ref(false)
  const cardList = ref<MtgCardData[]>([])
  const cardPrintList = ref<MtgCardData[]>([])
  const card = ref<MtgCardData | null>(null)
  const selectedFormat = ref<MtgSet>('all')
  const selectedTimeoutSeconds = ref(0)

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

  function handleSync(data: MtgCardData | null) {
    card.value = data
    if (data) {
      searchCardPrints(data.name)
      updateCountdownFromCardData(data)
    }
    else {
      reset()
    }
  }

  function handleSubscribed(data: MtgCardData | null) {
    if (data) {
      card.value = data
      searchCardPrints(data.name)
      updateCountdownFromCardData(data)
    }
    else {
      reset()
    }
  }

  function updateCountdownFromCardData(cardData: MtgCardData) {
    if (cardData.displayData.hidden) {
      reset()
    }
    else if (cardData.displayData.timeoutStartTimestamp && cardData.displayData.timeoutDuration) {
      const elapsedMilliseconds = Date.now() - cardData.displayData.timeoutStartTimestamp
      const remainingMilliseconds = Math.round((cardData.displayData.timeoutDuration - elapsedMilliseconds) / 1000) * 1000
      if (remainingMilliseconds > 0) {
        start(remainingMilliseconds / 1000)
      }
      else {
        if (card.value)
          card.value.displayData.hidden = true
        reset()
      }
    }
    else {
      reset()
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
      cardList.value = data.data.map(card => parseMtgCard(card))
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
        q: `"${exactName}" game:paper`,
        unique: 'prints',
        order: 'released',
      },
    }).then((data) => {
      cardPrintList.value = data.data.map(card => parseMtgCard(card))
    }).catch(() => {
      cardPrintList.value = []
      loading.value = false
    }).finally(() => {
      loading.value = false
    })
  }

  async function setCardImage(cardData: MtgCardData) {
    publish('mtgCard', {
      action: 'set',
      card: cardData,
    })
  }

  async function selectCard(cardData: MtgCardData, isPrinting: boolean = false) {
    loading.value = true

    const newCardData = {
      ...cardData,
      displayData: {
        hidden: !isPrinting,
        flipped: false,
        turnedOver: false,
        rotated: cardData.orientationData.defaultRotated,
        counterRotated: false,
        timeoutStartTimestamp: undefined,
        timeoutDuration: undefined,
      },
    }

    card.value = newCardData

    await searchCardPrints(cardData.name)
    await setCardImage(newCardData)

    pushToHistory(newCardData)

    loading.value = false
  }

  function pushToHistory(cardData: MtgCardData) {
    const cardCopy = JSON.parse(JSON.stringify(cardData))
    const existingIndex = history.value.findIndex(card => card.name === cardData.name)
    if (existingIndex !== -1) {
      history.value.splice(existingIndex, 1)
    }

    history.value.unshift(cardCopy)
  }

  async function selectMeldCardPart(cardName: string) {
    loading.value = true
    const data = await $fetch<ScryfallCard.Any>('https://api.scryfall.com/cards/named', {
      query: {
        exact: cardName,
        unique: 'prints',
      },
    })
    const parsedCard = parseMtgCard(data)

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

    publish('mtgCard', {
      action: 'set',
      card: parsedCard,
    })

    await searchCardPrints(cardName)
    loading.value = false
  }

  function clearCard() {
    card.value = null
    publish('mtgCard', {
      action: 'clear',
    })
    reset()
  }

  function hideCard() {
    if (!card.value)
      return
    publish('mtgCard', {
      action: 'hide',
    })
    reset()
  }

  function showCard() {
    if (!card.value)
      return

    const payload: { action: 'show', timeOut?: number } = { action: 'show' }

    if (selectedTimeoutSeconds.value > 0) {
      payload.timeOut = selectedTimeoutSeconds.value
    }

    publish('mtgCard', payload)
  }

  function rotateCard() {
    card.value!.displayData.rotated = !card.value!.displayData.rotated
    publish('mtgCard', {
      action: 'rotate',
    })
  }

  function counterRotateCard() {
    card.value!.displayData.counterRotated = !card.value!.displayData.counterRotated
    publish('mtgCard', {
      action: 'counterRotate',
    })
  }

  function flipCard() {
    card.value!.displayData.flipped = !card.value!.displayData.flipped
    publish('mtgCard', {
      action: 'flip',
    })
  }

  function turnOverCard() {
    card.value!.displayData.turnedOver = !card.value!.displayData.turnedOver
    publish('mtgCard', {
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
    selectedTimeoutSeconds,
    cardPrintList,
    loading,
    card,
    cardList,
    history,
    remaining,
    isActive,
  }
})
