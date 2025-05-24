type Params<T extends Topic> = {
  topic: T
  actions?: TopicActions<T>
  handleMessage?: (event: NameSpaceServerEventName<T>, data: TopicData<T>) => void
}

export function useWS<T extends Topic = never>(params: Params<T>) {
  const ws = useNuxtApp().$ws

  if (!ws) {
    throw new Error('Socket plugin not initialized')
  }

  const actions = params.actions
  const id = useId()

  const onMessage = (event: NameSpaceServerEventName<T>, data: TopicData<T>) => {
    if (params.handleMessage) {
      params.handleMessage(event, data)
    }
    if (actions) {
      if (event in actions) {
        (actions[event] as (data: TopicData<T>) => void)(data)
      }
    }
  }

  const socket = ws.subscribe(params.topic, id, onMessage)

  onUnmounted(() => {
    ws.unsubscribeStore(id)
  })

  return {
    baseSocket: ws,
    socket,
  }
}
