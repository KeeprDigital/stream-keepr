export const useEventStore = defineStore('Event', () => {
  const toast = useToast()
  const configStore = useConfigStore()
  const formData = ref<EventData>()
  const state = shallowRef<EventData>()

  const { optimisticEmit } = useWS({
    topic: 'event',
    serverEvents: {
      connected: data => state.value = data,
      sync: data => state.value = data,
    },
  })

  watch(state, (newVal) => {
    formData.value = JSON.parse(JSON.stringify(newVal))
    ensureDefaults()
  })

  // Ensure defaults are set when in tournament mode
  function ensureDefaults() {
    if (configStore.tournament.eventMode === 'tournament' && formData.value) {
      let needsUpdate = false

      // Default to first day if not set
      const firstDay = configStore.dayOptions[0]
      if (!formData.value.currentDay && firstDay) {
        formData.value.currentDay = firstDay
        needsUpdate = true
      }

      // Default to first round if not set
      const firstRound = configStore.roundOptions[0]
      if (!formData.value.currentRound && firstRound) {
        formData.value.currentRound = firstRound
        needsUpdate = true
      }

      // Auto-save if we made changes
      if (needsUpdate) {
        nextTick(() => save())
      }
    }
  }

  // Watch for changes in event mode and ensure defaults
  watch(
    () => configStore.tournament.eventMode,
    () => ensureDefaults(),
    { immediate: true },
  )

  const isDirty = computed(() => {
    return JSON.stringify(state.value) !== JSON.stringify(formData.value)
  })

  function save() {
    if (formData.value) {
      if (formData.value.leftTalent === '<Blank>')
        formData.value.leftTalent = ''
      if (formData.value.rightTalent === '<Blank>')
        formData.value.rightTalent = ''

      optimisticEmit('set', {
        initialState: state.value,
        action: () => state.value = formData.value,
        onSuccess: () => {
          toast.add({
            title: 'Event saved',
            icon: 'i-lucide-circle-check',
            color: 'success',
          })
        },
        onError: () => {
          toast.add({
            title: 'Error saving event',
            icon: 'i-lucide-triangle-alert',
            color: 'error',
          })
        },
        rollback: initialState => state.value = initialState,
      }, formData.value)
    }
  }

  function reset() {
    formData.value = structuredClone(state.value)
  }

  return {
    formData,
    isDirty,
    save,
    reset,
  }
})
