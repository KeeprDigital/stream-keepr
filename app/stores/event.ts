import type { EventData } from '~~/shared/schemas/event'
import { defaultEventData } from '~~/shared/utils/defaults'

export const useEventStore = defineStore('Event', () => {
  const storeId = 'event-store'
  const socketStore = useSocket()
  const toast = useToast()

  const loading = ref(false)

  const state = ref<EventData>(defaultEventData)

  const { cloned, sync } = useCloned(state, { manual: true })

  function init() {
    if (!socketStore.isSubscribed('event')) {
      socketStore.subscribe('event', storeId, handleEvent, handleSubscribed)
    }
  }

  function handleEvent(data: EventData | null) {
    if (data) {
      state.value = data
    }
    loading.value = false
    sync()
  }

  function handleSubscribed(data: EventData | null) {
    if (data) {
      state.value = data
      loading.value = false
      sync()
    }
  }

  function save() {
    loading.value = true
    sync()
    socketStore.publish('event', {
      action: 'set',
      event: state.value,
    })
    toast.add({
      title: 'Event updated',
    })
    loading.value = false
  }

  function reset() {
    state.value = cloned.value
    sync()
  }

  onUnmounted(() => {
    socketStore.unsubscribe('event', storeId)
  })

  init()

  return {
    state,
    loading,
    save,
    reset,
  }
})
