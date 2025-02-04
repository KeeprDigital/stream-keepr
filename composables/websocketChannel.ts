import type { Payload } from '~/types/websocket'

export function useWebSocketChannel<T extends keyof Payload>(channel: T) {
  const { $ws } = useNuxtApp()
  const incoming = computed(() => $ws.channels[channel].incoming)
  const outgoing = computed(() => $ws.channels[channel].outgoing)

  const send = (payload: Payload[T]['outgoing']) => {
    $ws.sendMessage(channel, payload)
  }

  return {
    incoming,
    outgoing,
    send,
  }
}
