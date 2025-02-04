import type { EventData } from '~/types/eventData'

export const useEventStore = defineStore('Event', () => {
  // const { send } = useWebSocket(`ws://${window.location.host}/api/ws`)
  const loading = ref(false)

  const eventState = ref<EventData>({
    name: '',
    currentRound: '',
    leftTalent: '',
    rightTalent: '',
    holdingText: '',
  })

  const { cloned, sync } = useCloned(eventState, { manual: true })

  function reset() {
    eventState.value = cloned.value
    sync()
  }

  async function save() {
    loading.value = true

    // send(createWebSocketMessage('event', {
    //   action: 'set',
    //   event: eventState.value,
    // }))

    sync()

    loading.value = false
  }

  return {
    loading,
    eventState,
    save,
    reset,
  }
})
