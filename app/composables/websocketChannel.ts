export function useWebSocketChannel<T extends keyof Payload>(channel: T) {
  const { $ws } = useNuxtApp()
  const incoming = computed(() => $ws.channels[channel].incoming as Payload[T]['server'])
  const outgoing = computed(() => $ws.channels[channel].outgoing as Payload[T]['client'])

  const send = (payload: Payload[T]['client']) => {
    $ws.sendMessage(channel, payload)
  }

  return {
    incoming,
    outgoing,
    send,
  }
}
