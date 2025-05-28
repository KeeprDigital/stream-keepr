export const matchesHandler: NamespaceHandler<'matches'> = (namespace) => {
  namespace.on('connection', async (socket) => {
    socket.emit('connected', await getStore('matches') ?? [defaultMatchData])

    socket.on('add', async (ack) => {
      const matches = await getStore('matches') ?? []
      const newMatch = {
        ...defaultMatchData,
        id: crypto.randomUUID(),
      }
      matches.push(newMatch)
      setStore('matches', matches)
      ack({
        success: true,
        timestamp: Date.now(),
      })
      namespace.except(socket.id).emit('sync', matches)
    })

    socket.on('remove', async (id, ack) => {
      const matches = await getStore('matches')
      if (matches) {
        matches.splice(matches.findIndex(match => match.id === id), 1)
        setStore('matches', matches)
        ack({
          success: true,
          timestamp: Date.now(),
        })
        namespace.except(socket.id).emit('sync', matches)
      }
    })

    socket.on('set', async (match, ack) => {
      const matches = await getStore('matches')
      if (matches) {
        const index = matches.findIndex(m => m.id === match.id)
        if (index !== -1) {
          matches[index] = match
          setStore('matches', matches)
          ack({
            success: true,
            timestamp: Date.now(),
          })
          namespace.except(socket.id).emit('sync', matches)
        }
      }
    })
  })
}
