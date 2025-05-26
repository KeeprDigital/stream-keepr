import { Server as Engine } from 'engine.io'
import { defineEventHandler } from 'h3'
import { Server } from 'socket.io'

export default defineNitroPlugin((nitroApp) => {
  const engine = new Engine()

  nitroApp.router.use('/socket.io/', defineEventHandler({
    handler(event) {
      // @ts-expect-error incorrect type from nitro
      engine.handleRequest(event.node.req, event.node.res)
      event._handled = true
    },
    websocket: {
      open(peer) {
        // @ts-expect-error private method and property
        engine.prepare(peer._internal.nodeReq)
        // @ts-expect-error private method and property
        engine.onWebSocket(peer._internal.nodeReq, peer._internal.nodeReq.socket, peer.websocket)
      },
    },
  }))

  const socket = new Server<ClientEvents, ServerEvents, InterServerEvents, SocketData>().bind(engine)
  const opCardNamespace: NameSpaceServer<'opCard'> = socket.of('/opCard')
  const mtgCardNamespace: NameSpaceServer<'mtgCard'> = socket.of('/mtgCard')
  const eventNamespace: NameSpaceServer<'event'> = socket.of('/event')
  const matchesNamespace: NameSpaceServer<'matches'> = socket.of('/matches')
  const configNamespace: NameSpaceServer<'config'> = socket.of('/config')

  eventNamespace.on('connection', async (socket) => {
    socket.emit('connected', await getStore('event') ?? defaultEventData)

    socket.on('set', (event) => {
      setStore('event', event)
      eventNamespace.except(socket.id).emit('sync', event)
    })
  })

  opCardNamespace.on('connection', (socket) => {
    socket.emit('connected', null as any)
  })

  mtgCardNamespace.on('connection', (socket) => {
    socket.emit('connected', null as any)

    socket.on('clear', () => {
      console.log('clear')
    })
  })

  matchesNamespace.on('connection', async (socket) => {
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
      matchesNamespace.except(socket.id).emit('sync', matches)
    })

    socket.on('remove', async (id, callback) => {
      const matches = await getStore('matches')
      if (matches) {
        matches.splice(matches.findIndex(match => match.id === id), 1)
        setStore('matches', matches)
        callback(id)
        matchesNamespace.except(socket.id).emit('sync', matches)
      }
    })

    socket.on('set', async (match, callback) => {
      const matches = await getStore('matches')
      if (matches) {
        const index = matches.findIndex(m => m.id === match.id)
        if (index !== -1) {
          matches[index] = match
          setStore('matches', matches)
          matchesNamespace.except(socket.id).emit('sync', matches)
        }
      }
      callback(match)
    })
  })

  configNamespace.on('connection', async (socket) => {
    socket.emit('connected', await getStore('config') ?? defaultConfigData)

    socket.on('set', (config) => {
      setStore('config', config)
      configNamespace.except(socket.id).emit('sync', config)
    })
  })
})
