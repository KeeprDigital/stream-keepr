export const configHandler: NamespaceHandler<'config'> = (namespace) => {
  namespace.on('connection', async (socket) => {
    socket.emit('connected', await getStore('config') ?? defaultConfigData)

    socket.on('set', (config, ack) => {
      setStore('config', config)
      ack({
        success: true,
        timestamp: Date.now(),
      })
      namespace.except(socket.id).emit('sync', config)
    })
  })
}
