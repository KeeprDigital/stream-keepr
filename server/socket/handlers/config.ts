export const configHandler: NamespaceHandler<'config'> = (namespace) => {
  namespace.on('connection', async (socket) => {
    socket.emit('connected', await getStore('config') ?? defaultConfigData)

    socket.on('set', (config) => {
      setStore('config', config)
      namespace.except(socket.id).emit('sync', config)
    })
  })
}
