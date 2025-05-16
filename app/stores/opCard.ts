import type { OpCardData } from '~~/shared/schemas/opCard'
import { useCountdown, useStorage } from '@vueuse/core'
import { opCardSchema } from '~~/shared/schemas/opCard'

export const useOpCardStore = defineStore('OpCard', () => {
  const storeId = 'op-card-store'

  const { start, reset, remaining, isActive } = useCountdown(0)

  const socketStore = useSocket()
  const { publish } = socketStore

  const history = useStorage<OpCardData[]>('card-history', [])

  const loading = ref(false)
  const cardList = ref<OpCardData[]>([])
  const card = ref<OpCardData | null>(null)
  const selectedTimeoutSeconds = ref(0)
  const selectedColour = ref('any')
  const cost = ref<number | null>(null)

  function init() {
    if (!socketStore.isSubscribed('opCard')) {
      socketStore.subscribe('opCard', storeId, handleSync, handleSubscribed)
    }
  }

  function handleSync(data: OpCardData | null) {
    card.value = data
    if (data) {
      updateCountdownFromCardData(data)
    }
    else {
      reset()
    }
  }

  function handleSubscribed(data: OpCardData | null) {
    if (data) {
      card.value = data
      updateCountdownFromCardData(data)
    }
    else {
      reset()
    }
  }

  function updateCountdownFromCardData(cardData: OpCardData) {
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
        if (card.value && card.value.displayData)
          card.value.displayData.hidden = true
        reset()
      }
    }
    else {
      reset()
    }
  }

  async function searchFuzzyCardName(name: string) {
    loading.value = true
    if (name.length < 3) {
      clearSearch()
      return
    }

    await $fetch<Omit<OpCardData, 'displayData'>[]>('/api/op/card', {
      query: {
        name,
        cost: cost.value ?? undefined,
        color: selectedColour.value === 'any' ? undefined : selectedColour.value,
      },
    }).then((data) => {
      if (!data) {
        cardList.value = []
        return
      }
      cardList.value = data.map(card => opCardSchema.parse(card))
    }).catch((error) => {
      console.error(error)
      cardList.value = []
    }).finally(() => {
      loading.value = false
    })
  }

  async function setCardImage(cardData: OpCardData) {
    publish('opCard', {
      action: 'set',
      card: cardData,
    })
  }

  async function selectCard(cardData: OpCardData) {
    loading.value = true
    card.value = cardData

    await setCardImage(cardData)

    pushToHistory(cardData)

    loading.value = false
  }

  function pushToHistory(cardData: OpCardData) {
    const existingIndex = history.value.findIndex(card => card.id === cardData.id && card.code === cardData.code)
    if (existingIndex !== -1) {
      history.value.splice(existingIndex, 1)
    }
    const cardCopy = JSON.parse(JSON.stringify(cardData))
    history.value.unshift(cardCopy)
  }

  function clearCard() {
    card.value = null
    publish('opCard', {
      action: 'clear',
    })
    reset()
  }

  function hideCard() {
    if (!card.value)
      return
    publish('opCard', {
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

    publish('opCard', payload)
  }

  function clearSearch() {
    loading.value = false
    cardList.value = []
    selectedColour.value = 'any'
    cost.value = null
  }

  function clearHistory() {
    history.value = []
  }

  init()

  return {
    searchFuzzyCardName,
    setCardImage,
    selectCard,
    clearCard,
    hideCard,
    showCard,
    clearSearch,
    pushToHistory,
    clearHistory,
    selectedTimeoutSeconds,
    loading,
    card,
    cardList,
    history,
    remaining,
    isActive,
    selectedColour,
    cost,
  }
})
