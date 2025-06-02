import { defineStore } from 'pinia'

export const useTimeStore = defineStore('Time', () => {
  const serverOffset = ref(0)
  const currentTime = ref(new Date())
  const lastSyncTime = ref<Date | null>(null)
  const lastUpdateTime = ref<Date | null>(null)
  const roundTripTime = ref(0)
  const syncAccuracy = ref(0)
  const syncMethod = ref<'precision' | 'broadcast' | 'none'>('none')

  const { emit } = useWS({
    topic: 'time',
    serverEvents: {
      syncResponse: handleTimeSyncResponse,
      timeUpdate: handleTimeUpdate,
    },
  })

  function handleTimeUpdate(data: { timestamp: number }) {
    const clientReceiveTime = Date.now()
    const broadcastOffset = data.timestamp - clientReceiveTime

    // Light smoothing for broadcasts
    if (lastUpdateTime.value) {
      serverOffset.value = (serverOffset.value * 0.9) + (broadcastOffset * 0.1)
    }
    else {
      serverOffset.value = broadcastOffset
    }

    lastUpdateTime.value = new Date()
    updateCurrentTime()
  }

  function handleTimeSyncResponse(data: TimeSyncResponse) {
    const clientEndTime = Date.now()
    const roundTrip = clientEndTime - data.clientTimestamp
    const networkDelay = (roundTrip - data.serverProcessingTime) / 2

    // Calculate server time accounting for network delay
    const estimatedServerTime = data.serverTime + networkDelay
    const newOffset = estimatedServerTime - clientEndTime

    // Use weighted average to smooth out network jitter
    if (lastSyncTime.value) {
      serverOffset.value = (serverOffset.value * 0.8) + (newOffset * 0.2)
    }
    else {
      serverOffset.value = newOffset
    }

    roundTripTime.value = roundTrip
    syncAccuracy.value = Math.abs(networkDelay)
    lastSyncTime.value = new Date()
    syncMethod.value = 'precision'

    updateCurrentTime()
  }

  function performTimeSync() {
    const clientTimestamp = Date.now()
    emit('syncRequest', clientTimestamp)
  }

  function updateCurrentTime() {
    currentTime.value = new Date(Date.now() + serverOffset.value)
  }

  // Auto-sync every 30 seconds
  let syncInterval: NodeJS.Timeout

  function startAutoSync() {
    syncInterval = setInterval(() => {
      performTimeSync()
    }, 30000)
  }

  function stopAutoSync() {
    if (syncInterval) {
      clearInterval(syncInterval)
    }
  }

  // Computed properties for component use
  const timeSinceLastUpdate = computed(() => {
    if (!lastUpdateTime.value)
      return null
    return Math.floor((Date.now() - lastUpdateTime.value.getTime()) / 1000)
  })

  const timeSinceLastSync = computed(() => {
    if (!lastSyncTime.value)
      return null
    return Math.floor((Date.now() - lastSyncTime.value.getTime()) / 1000)
  })

  const isStale = computed(() => {
    const updateStale = lastUpdateTime.value
      ? (Date.now() - lastUpdateTime.value.getTime()) > 120000
      : true // 2 minutes
    const syncStale = lastSyncTime.value
      ? (Date.now() - lastSyncTime.value.getTime()) > 300000
      : true // 5 minutes

    return updateStale && syncStale
  })

  return {
    serverOffset: readonly(serverOffset),
    currentTime: readonly(currentTime),
    lastSyncTime: readonly(lastSyncTime),
    lastUpdateTime: readonly(lastUpdateTime),
    roundTripTime: readonly(roundTripTime),
    syncAccuracy: readonly(syncAccuracy),
    syncMethod: readonly(syncMethod),
    timeSinceLastUpdate,
    timeSinceLastSync,
    isStale,
    performTimeSync,
    startAutoSync,
    stopAutoSync,
  }
})
