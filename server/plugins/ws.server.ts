import { Server as Engine } from 'engine.io'
import { defineEventHandler } from 'h3'
import { Server } from 'socket.io'
import { setupNamespaces } from '../socket/namespaces'

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

  setupNamespaces(socket)
})
