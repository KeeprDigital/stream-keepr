import type { Server } from 'socket.io'
import { configHandler } from './handlers/config'
import { eventHandler } from './handlers/event'
import { matchesHandler } from './handlers/matches'
import { mtgCardHandler } from './handlers/mtgCard'
import { opCardHandler } from './handlers/opCard'
import { timeHandler } from './handlers/time'

type SocketServer = Server<ClientEvents, ServerEvents, InterServerEvents, SocketData>

export function setupNamespaces(socket: SocketServer) {
  const namespaces = {
    opCard: socket.of('/opCard') as NameSpaceServer<'opCard'>,
    mtgCard: socket.of('/mtgCard') as NameSpaceServer<'mtgCard'>,
    event: socket.of('/event') as NameSpaceServer<'event'>,
    matches: socket.of('/matches') as NameSpaceServer<'matches'>,
    config: socket.of('/config') as NameSpaceServer<'config'>,
    time: socket.of('/time') as NameSpaceServer<'time'>,
  }

  opCardHandler(namespaces.opCard)
  mtgCardHandler(namespaces.mtgCard)
  eventHandler(namespaces.event)
  matchesHandler(namespaces.matches)
  configHandler(namespaces.config)
  timeHandler(namespaces.time)

  return namespaces
}
