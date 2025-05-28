export const opCardHandler: NamespaceHandler<'opCard'> = (namespace) => {
  namespace.on('connection', async (socket) => {
    socket.emit('connected', await getStore('opCard'))

    socket.on('set', (card, ack) => {
      setStore('opCard', card)
      ack({
        success: true,
        timestamp: Date.now(),
      })
      namespace.except(socket.id).emit('sync', card)
    })

    socket.on('hide', async (ack) => {
      const card = await getStore('opCard')
      if (card) {
        setStore('opCard', {
          ...card,
          displayData: {
            ...card.displayData,
            hidden: true,
          },
        })
        ack({
          success: true,
          timestamp: Date.now(),
        })
        namespace.except(socket.id).emit('sync', card)
      }
    })

    socket.on('show', async (timeout, ack) => {
      const card = await getStore('opCard')
      if (card) {
        setStore('opCard', {
          ...card,
          displayData: {
            ...card.displayData,
            hidden: false,
            timeoutStartTimestamp: Date.now(),
            timeoutDuration: timeout * 1000,
          },
        })
        // TODO: add timeout
        ack({
          success: true,
          timestamp: Date.now(),
        })
        namespace.except(socket.id).emit('sync', card)
      }
    })
  })
}
