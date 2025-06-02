export const opCardHandler: NamespaceHandler<'opCard'> = (namespace) => {
  let activeTimeout: NodeJS.Timeout | null = null

  const clearActiveTimeout = () => {
    if (activeTimeout) {
      clearTimeout(activeTimeout)
      activeTimeout = null
    }
  }
  namespace.on('connection', async (socket) => {
    socket.emit('connected', await getStore('opCard'))

    socket.on('set', (card, ack) => {
      setStore('opCard', card)
      ack({
        success: true,
        timestamp: Date.now(),
      })

      if (card.timeoutData && card.timeoutData.timeoutDuration > 0) {
        activeTimeout = setTimeout(() => {
          clearStore('opCard')
          namespace.emit('sync', null)
          activeTimeout = null
        }, card.timeoutData.timeoutDuration * 1000)
      }

      namespace.except(socket.id).emit('sync', card)
    })

    socket.on('control', (action, ack) => {
      switch (action) {
        case 'clear':
          clearActiveTimeout()
          clearStore('opCard')
          namespace.except(socket.id).emit('sync', null)
          activeTimeout = null
          break
      }
      ack({
        success: true,
        timestamp: Date.now(),
      })
    })
  })
}
