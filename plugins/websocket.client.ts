import type { Payload, WebSocketMessage } from '~/types/websocket'

export default defineNuxtPlugin(() => {
  const { send, data } = useWebSocket(`ws://${window.location.host}/api/ws`, {
    autoReconnect: true,
  })

  const sendMessage = <T extends keyof Payload>(
    channel: T,
    payload: Payload[T]['client'],
  ) => {
    send(JSON.stringify({
      channel,
      direction: 'out',
      payload,
    }))
  }

  const channels = reactive<Record<keyof Payload, {
    outgoing: Payload[keyof Payload]['client'] | null
    incoming: Payload[keyof Payload]['server'] | null
  }>>({
    card: {
      outgoing: null,
      incoming: null,
    },
    event: {
      outgoing: null,
      incoming: null,
    },
    player: {
      outgoing: null,
      incoming: null,
    },
  })

  watch(data, (raw) => {
    const message = JSON.parse(raw) as WebSocketMessage<keyof Payload>
    if (message.direction === 'in') {
      channels[message.channel].incoming = message.payload
    }
  })

  return {
    provide: {
      ws: {
        channels,
        sendMessage,
      },
    },
  }
})
