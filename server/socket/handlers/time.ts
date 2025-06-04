export const timeHandler: NamespaceHandler<'time'> = (namespace) => {
  const clientSyncTracker = new Map<string, number>()
  const SYNC_TIMEOUT = 45000
  const BROADCAST_INTERVAL = 30000

  // Global broadcast timer
  setInterval(() => {
    const now = Date.now()

    // Get all connected sockets that need fallback updates
    const socketsNeedingUpdate = Array.from(namespace.sockets.values()).filter((socket) => {
      const lastClientSync = clientSyncTracker.get(socket.id) || 0
      return now - lastClientSync > SYNC_TIMEOUT
    })

    if (socketsNeedingUpdate.length > 0) {
      console.debug(`Sending fallback time updates to ${socketsNeedingUpdate.length} clients`)

      socketsNeedingUpdate.forEach((socket) => {
        socket.emit('timeUpdate', {
          timestamp: now,
          iso: new Date(now).toISOString(),
        })
      })
    }
  }, BROADCAST_INTERVAL)

  namespace.on('connection', (socket) => {
    socket.on('syncRequest', (clientTimestamp) => {
      const requestReceiveTime = Date.now()
      clientSyncTracker.set(socket.id, requestReceiveTime)

      const serverTime = Date.now()
      const serverProcessingTime = serverTime - requestReceiveTime

      socket.emit('syncResponse', {
        clientTimestamp,
        serverTime,
        serverProcessingTime,
      })
    })

    socket.on('disconnect', () => {
      clientSyncTracker.delete(socket.id)
    })
  })
}
