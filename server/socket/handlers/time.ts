export const timeHandler: NamespaceHandler<'time'> = (namespace) => {
  namespace.on('connection', (socket) => {
    socket.on('syncRequest', (clientTimestamp) => {
      const serverTime = Date.now()
      socket.emit('syncResponse', {
        clientTimestamp,
        serverTime,
        serverProcessingTime: Date.now() - serverTime,
      })
    })

    const timeInterval = setInterval(() => {
      socket.emit('timeUpdate', {
        timestamp: Date.now(),
        iso: new Date().toISOString(),
      })
    }, 10 * 3000)

    socket.on('disconnect', () => {
      clearInterval(timeInterval)
    })
  })
}
