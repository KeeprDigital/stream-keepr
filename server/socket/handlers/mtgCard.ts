export const mtgCardHandler: NamespaceHandler<'mtgCard'> = (namespace) => {
  namespace.on('connection', (socket) => {
    socket.emit('connected', null as any)

    socket.on('clear', () => {
      console.log('clear')
    })
  })
}
