import type { ScryfallCard, ScryfallList } from '@scryfall/api-types'
import type { MtgActiveCardAction } from '~~/shared/types/mtgCard'
import { useCountdown, useStorage } from '@vueuse/core'

export const useMtgCardStore = defineStore('MtgCard', () => {
  const toast = useToast()
  const configStore = useConfigStore()
  const timeout = useCountdown(0)
  const selectionHistory = useStorage<MtgCardData[]>('mtgCard-history', [])

  const previewCard = ref<MtgCardData | null>(null)
  const previewCardPrintings = ref<MtgCardData[]>([])

  const activeCard = ref<MtgCardData | null>(null)

  const searching = ref(false)
  const searchResults = ref<MtgCardData[]>([])
  const selectedSearchFormat = ref<MtgFormat>('all')

  const { optimisticEmit } = useWS({
    topic: 'mtgCard',
    serverEvents: {
      connected: (data) => {
        activeCard.value = data
        updateTimeout(data)
      },
      sync: (data) => {
        activeCard.value = data
        updateTimeout(data)
      },
    },
  })

  const cardsMatch = computed(() => {
    return activeCard.value?.id === previewCard.value?.id
      && JSON.stringify(activeCard.value?.displayData) === JSON.stringify(previewCard.value?.displayData)
  })

  const searchFormatQuery = computed(() => {
    switch (selectedSearchFormat.value) {
      case 'all':
        return ''
      case 'token':
        return 'is:token'
      default:
        return `format:${selectedSearchFormat.value}`
    }
  })

  async function searchFuzzyCardName(name: string) {
    searching.value = true
    if (name.length < 3) {
      clearSearch()
      return
    }

    await $fetch<ScryfallList.Cards>('https://api.scryfall.com/cards/search', {
      query: {
        q: `${name} game:paper ${searchFormatQuery.value}`,
        unique: 'cards',
      },
    }).then((data) => {
      if (!data) {
        searchResults.value = []
        return
      }
      searchResults.value = data.data.map(card => parseMtgCard(card))
    }).catch(() => {
      searchResults.value = []
    }).finally(() => {
      searching.value = false
    })
  }

  async function searchCardPrints(exactName: string) {
    searching.value = true
    await $fetch<ScryfallList.Cards>('https://api.scryfall.com/cards/search', {
      query: {
        q: `"${exactName}" game:paper`,
        unique: 'prints',
        order: 'released',
      },
    }).then((data) => {
      previewCardPrintings.value = data.data.map(card => parseMtgCard(card))
    }).catch(() => {
      previewCardPrintings.value = []
    }).finally(() => {
      searching.value = false
    })
  }

  async function selectPreviewCard(cardData: MtgCardData, turnedOver: boolean) {
    let shouldSearchPrintings = true

    if (cardData.id === previewCard.value?.id) {
      // Card is the same, check if turned over state is the same
      if (turnedOver === previewCard.value.displayData.turnedOver) {
        // Card is identical, no need to update
        return
      }
      else {
        // Card is identical, but turned over state is different, no need to search printings again
        shouldSearchPrintings = false
      }
    }

    previewCard.value = JSON.parse(JSON.stringify(cardData))

    if (turnedOver && previewCard.value)
      previewCard.value.displayData.turnedOver = true

    pushToHistory(cardData)

    if (shouldSearchPrintings) {
      previewCardPrintings.value = []
      await searchCardPrints(cardData.name)
    }
  }

  async function selectMeldCardPart(cardName: string) {
    searching.value = true
    const data = await $fetch<ScryfallCard.Any>('https://api.scryfall.com/cards/named', {
      query: {
        exact: cardName,
        unique: 'prints',
      },
    })

    previewCard.value = parseMtgCard(data)

    await searchCardPrints(cardName)
    searching.value = false
  }

  function controlPreviewCard(action: MtgPreviewCardAction) {
    if (!previewCard.value)
      return

    switch (action) {
      case 'show' : {
        const action = activeCard.value ? 'replaced' : 'set'
        const cardData = previewCard.value

        cardData.timeoutData = {
          timeoutDuration: configStore.overlay.cardTimeout,
          timeoutStartTimestamp: Date.now(),
        }

        optimisticEmit('set', {
          initialState: activeCard.value,
          action: () => {
            activeCard.value = JSON.parse(JSON.stringify(previewCard.value))
            if (configStore.overlay.clearPreviewOnShow)
              previewCard.value = null
            updateTimeout(activeCard.value)
            return previewCard.value
          },
          onSuccess: () => {
            toast.add({
              title: `Card ${action}`,
              color: 'success',
            })
          },
          onError: () => {
            toast.add({
              title: `Card could not be ${action}`,
              color: 'error',
            })
          },
          rollback: (initialState, previousCard) => {
            activeCard.value = initialState
            if (configStore.overlay.clearPreviewOnShow && previousCard)
              previewCard.value = previousCard
          },
        }, cardData)
      }
        break
      case 'clear':
        previewCard.value = null
        break
      case 'flip':
        previewCard.value.displayData.flipped = !previewCard.value.displayData.flipped
        break
      case 'rotate':
        previewCard.value.displayData.rotated = !previewCard.value.displayData.rotated
        break
      case 'turnOver':
        previewCard.value.displayData.turnedOver = !previewCard.value.displayData.turnedOver
        break
      case 'counterRotate':
        previewCard.value.displayData.counterRotated = !previewCard.value.displayData.counterRotated
        break
    }
  }

  function updateTimeout(cardData: MtgCardData | null) {
    if (!cardData || !cardData.timeoutData) {
      timeout.reset()
      return
    }

    const { timeoutStartTimestamp, timeoutDuration } = cardData.timeoutData

    const elapsedMs = Date.now() - timeoutStartTimestamp
    const remainingMs = (timeoutDuration * 1000) - elapsedMs

    if (remainingMs <= 0) {
      timeout.reset()
      return
    }

    const remainingSeconds = Math.round(remainingMs / 1000)

    timeout.start(remainingSeconds)
  }

  function pushToHistory(cardData: MtgCardData) {
    const cardCopy = structuredClone(toRaw(cardData))
    const existingIndex = selectionHistory.value.findIndex(card => card.name === cardData.name)
    if (existingIndex !== -1) {
      selectionHistory.value.splice(existingIndex, 1)
    }

    selectionHistory.value.unshift(cardCopy)
  }

  function controlActiveCard(action: MtgActiveCardAction) {
    switch (action) {
      case 'clear':
        optimisticEmit('control', {
          initialState: activeCard.value,
          action: () => activeCard.value = null,
          onSuccess: () => {
            toast.add({
              title: 'Card cleared',
              color: 'success',
            })
          },
          onError: () => {
            toast.add({
              title: 'Error',
              description: 'The card could not be cleared',
              color: 'error',
            })
          },
          rollback: initialState => activeCard.value = initialState,
        }, action)
        break
    }
  }

  function clearSearch() {
    searching.value = false
    searchResults.value = []
  }

  function clearHistory() {
    selectionHistory.value = []
  }

  return {
    searchFuzzyCardName,
    selectPreviewCard,
    selectMeldCardPart,
    controlPreviewCard,
    controlActiveCard,
    clearSearch,
    clearHistory,
    selectedSearchFormat,
    previewCardPrintings,
    searching,
    activeCard,
    previewCard,
    searchResults,
    selectionHistory,
    timeout,
    cardsMatch,
  }
})
