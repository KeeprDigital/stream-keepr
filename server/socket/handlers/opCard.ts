export const opCardHandler: NamespaceHandler<'opCard'> = (namespace) => {
  namespace.on('connection', (socket) => {
    socket.emit('connected', null as any)
  })
}
