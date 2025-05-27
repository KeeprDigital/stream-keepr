export const eventHandler: NamespaceHandler<'event'> = (namespace) => {
  namespace.on('connection', async (socket) => {
    socket.emit('connected', await getStore('event') ?? defaultEventData)

    socket.on('set', (event, ack) => {
      setStore('event', event)
      ack({
        success: true,
        timestamp: Date.now(),
      })
      namespace.except(socket.id).emit('sync', event)
    })
  })
}
