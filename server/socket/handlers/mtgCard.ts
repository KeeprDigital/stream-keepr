export const mtgCardHandler: NamespaceHandler<'mtgCard'> = (namespace) => {
  namespace.on('connection', async (socket) => {
    socket.emit('connected', await getStore('mtgCard'))

    socket.on('set', (card, ack) => {
      setStore('mtgCard', card)
      ack({
        success: true,
        timestamp: Date.now(),
      })
      namespace.except(socket.id).emit('sync', card)
    })

    socket.on('clear', () => {
      clearStore('mtgCard')
    })

    socket.on('show', async (timeout, ack) => {
      const card = await getStore('mtgCard')
      if (card) {
        setStore('mtgCard', {
          ...card,
          displayData: {
            ...card.displayData,
            hidden: false,
            timeoutStartTimestamp: Date.now(),
            timeoutDuration: timeout,
          },
        })
        ack({
          success: true,
          timestamp: Date.now(),
        })
        namespace.except(socket.id).emit('sync', card)
      }
    })

    socket.on('hide', async (ack) => {
      const card = await getStore('mtgCard')
      if (card) {
        setStore('mtgCard', {
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

    socket.on('rotate', async (ack) => {
      const card = await getStore('mtgCard')
      if (card) {
        setStore('mtgCard', {
          ...card,
          displayData: {
            ...card.displayData,
            rotated: true,
          },
        })
        ack({
          success: true,
          timestamp: Date.now(),
        })
        namespace.except(socket.id).emit('sync', card)
      }
    })

    socket.on('counterRotate', async (ack) => {
      const card = await getStore('mtgCard')
      if (card) {
        setStore('mtgCard', {
          ...card,
          displayData: {
            ...card.displayData,
            counterRotated: true,
          },
        })
        ack({
          success: true,
          timestamp: Date.now(),
        })
        namespace.except(socket.id).emit('sync', card)
      }
    })

    socket.on('flip', async (ack) => {
      const card = await getStore('mtgCard')
      if (card) {
        setStore('mtgCard', {
          ...card,
          displayData: {
            ...card.displayData,
            flipped: true,
          },
        })
        ack({
          success: true,
          timestamp: Date.now(),
        })
        namespace.except(socket.id).emit('sync', card)
      }
    })

    socket.on('turnOver', async (ack) => {
      const card = await getStore('mtgCard')
      if (card) {
        setStore('mtgCard', {
          ...card,
          displayData: {
            ...card.displayData,
            turnedOver: true,
          },
        })
        ack({
          success: true,
          timestamp: Date.now(),
        })
        namespace.except(socket.id).emit('sync', card)
      }
    })
  })
}
