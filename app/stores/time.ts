export const useTimeStore = defineStore('time', () => {
  const serverOffset = ref(0)
  const lastSyncTime = ref<Date | null>(null)
  const lastUpdateTime = ref<Date | null>(null)
  const isSyncing = ref(false)

  const SERVER_SYNC_INTERVAL = 30000
  const LOCAL_UPDATE_INTERVAL = 500

  const localTime = useNow({ interval: LOCAL_UPDATE_INTERVAL })

  const currentTime = computed(() => {
    return new Date(localTime.value.getTime() + serverOffset.value)
  })

  const isTimeSynced = computed(() => {
    return lastSyncTime.value !== null
  })

  const { emit } = useWS({
    topic: 'time',
    serverEvents: {
      syncResponse: handleTimeSyncResponse,
      timeUpdate: handleTimeUpdate,
    },
  })

  let syncInterval: NodeJS.Timeout | null = null

  function performTimeSync() {
    const clientTimestamp = Date.now()
    emit('syncRequest', clientTimestamp)
  }

  function handleTimeSyncResponse(data: TimeSyncResponse) {
    const clientEndTime = Date.now()
    const roundTrip = clientEndTime - data.clientTimestamp
    const networkDelay = (roundTrip - data.serverProcessingTime) / 2

    // Calculate server time accounting for network delay
    const estimatedServerTime = data.serverTime + networkDelay
    const newOffset = estimatedServerTime - clientEndTime

    // Use weighted average to smooth out network jitter
    // Give more weight to sync responses than broadcast updates
    if (lastSyncTime.value) {
      serverOffset.value = (serverOffset.value * 0.7) + (newOffset * 0.3)
    }
    else {
      serverOffset.value = newOffset
    }

    lastSyncTime.value = new Date()
  }

  function handleTimeUpdate(data: TimeUpdate) {
    // Only apply broadcast updates if we've had an initial sync
    if (!isTimeSynced.value)
      return

    const clientReceiveTime = Date.now()
    const broadcastOffset = data.timestamp - clientReceiveTime

    // Use lighter weighting for broadcast updates
    if (lastUpdateTime.value) {
      serverOffset.value = (serverOffset.value * 0.95) + (broadcastOffset * 0.05)
    }

    lastUpdateTime.value = new Date()
  }

  function startPeriodicSync() {
    if (isSyncing.value)
      return

    isSyncing.value = true
    forceSync()
    syncInterval = setInterval(() => {
      performTimeSync()
    }, SERVER_SYNC_INTERVAL)
  }

  function stopPeriodicSync() {
    if (syncInterval) {
      clearInterval(syncInterval)
      syncInterval = null
    }
    isSyncing.value = false
  }

  function forceSync() {
    performTimeSync()
  }

  onUnmounted(() => {
    stopPeriodicSync()
  })

  return {
    currentTime,
    isSyncing,
    forceSync,
    startPeriodicSync,
    stopPeriodicSync,
  }
})
