export const matchesHandler: NamespaceHandler<'matches'> = (namespace) => {
  namespace.on('connection', async (socket) => {
    socket.emit('connected', await getStore('matches') ?? [])

    socket.on('add', async (callback) => {
      const matches = await getStore('matches') ?? []
      const newMatch = {
        ...defaultMatchData,
        id: crypto.randomUUID(),
      }
      matches.push(newMatch)
      setStore('matches', matches)
      callback(newMatch)
      namespace.except(socket.id).emit('sync', matches)
    })

    socket.on('remove', async (id, callback) => {
      const matches = await getStore('matches')
      if (matches) {
        matches.splice(matches.findIndex(match => match.id === id), 1)
        setStore('matches', matches)
        callback(id)
        namespace.except(socket.id).emit('sync', matches)
      }
    })

    socket.on('set', async (match, callback) => {
      const matches = await getStore('matches')
      if (matches) {
        const index = matches.findIndex(m => m.id === match.id)
        if (index !== -1) {
          matches[index] = match
          setStore('matches', matches)
          namespace.except(socket.id).emit('sync', matches)
        }
      }
      callback(match)
    })
  })
}
