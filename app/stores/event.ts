export const useEventStore = defineStore('Event', () => {
  const toast = useToast()
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
    formData.value = structuredClone(toRaw(newVal))
  })

  const isDirty = computed(() => {
    return JSON.stringify(state.value) !== JSON.stringify(formData.value)
  })

  function save() {
    if (formData.value) {
      optimisticEmit({
        initialState: state.value,
        action: () => state.value = formData.value,
        onSuccess: () => {
          toast.add({
            title: 'Event saved',
            icon: 'i-heroicons-check-circle',
            color: 'success',
          })
        },
        onError: () => {
          toast.add({
            title: 'Error saving event',
            icon: 'i-heroicons-exclamation-triangle',
            color: 'error',
          })
        },
        rollback: initialState => state.value = initialState,
      }, 'set', formData.value)
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
