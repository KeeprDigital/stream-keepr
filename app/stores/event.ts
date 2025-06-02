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
    formData.value = JSON.parse(JSON.stringify(newVal))
  })

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
