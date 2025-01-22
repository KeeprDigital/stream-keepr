import type { OverlayState } from '~/types/overlay'

export const useOverlayStore = defineStore('Overlay', () => {
  const loading = ref(false)

  const overlayState = ref<OverlayState>({
    topPlayer: {
      name: '',
      proNouns: '',
      deck: '',
      position: '',
      score: {
        wins: 0,
        losses: 0,
        draws: 0,
      },
    },
    bottomPlayer: {
      name: '',
      proNouns: '',
      deck: '',
      position: '',
      score: {
        wins: 0,
        losses: 0,
        draws: 0,
      },
    },
    event: {
      name: '',
      currentRound: '',
      leftTalent: '',
      rightTalent: '',
    },
  })

  const { cloned, sync } = useCloned(overlayState, { manual: true })

  function reset() {
    overlayState.value = cloned.value
    sync()
  }

  async function loadState() {
    loading.value = true
    await $fetch('/api/overlay/state').then((data) => {
      if (data) {
        overlayState.value = data
        sync()
      }
    }).catch(() => {
    }).finally(() => {
      loading.value = false
    })
  }

  async function saveState() {
    loading.value = true
    await $fetch('/api/overlay/state', {
      method: 'POST',
      body: {
        overlay: overlayState.value,
      },
    }).then((data) => {
      if (data) {
        overlayState.value = data
        sync()
      }
    }).catch(() => {
    }).finally(() => {
      loading.value = false
    })
  }

  return {
    loading,
    overlayState,
    saveState,
    loadState,
    reset,
    cloned,
  }
})
