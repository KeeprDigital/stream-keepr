export const useEventStore = defineStore('Event', () => {
  const { send, incoming } = useWebSocketChannel('event')
  const toast = useToast()
  const loading = ref(false)

  const eventState = ref<EventData>({
    name: '',
    currentRound: '',
    leftTalent: '',
    rightTalent: '',
    holdingText: '',
  })

  const { cloned, sync } = useCloned(eventState, { manual: true })

  watch(incoming, (data) => {
    if (data) {
      eventState.value = data.event
      sync()
    }
  }, {
    immediate: true,
  })

  function reset() {
    eventState.value = cloned.value
    sync()
  }

  async function save() {
    loading.value = true
    send({
      action: 'set',
      event: eventState.value,
    })

    sync()

    toast.add({
      title: 'Event Details Updated',
    })

    loading.value = false
  }

  return {
    loading,
    eventState,
    save,
    reset,
  }
})
