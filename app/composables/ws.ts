type OptimisticOptions<TState = any> = {
  initialState: TState
  action: (initialState: TState) => void
  onSuccess?: () => void
  onError?: (error: ErrorAckResponse, initialState: TState) => void
  rollback: (initialState: TState) => void
  timeout?: number
}

export type Params<TTopic extends Topic> = {
  topic: TTopic
  actions?: TopicServerEvents<TTopic>
  serverEvents?: TopicServerEvents<TTopic>
  handleMessage?: (event: NameSpaceServerEventName<TTopic>, data: TopicData<TTopic>) => void
}

export function useWS<T extends Topic = never>(params: Params<T>) {
  const ws = useNuxtApp().$ws ?? (() => {
    throw new Error('Socket plugin not initialized')
  })()

  const serverEvents = params.serverEvents
  const id = useId()

  const pendingOperations = ref(new Map<string, OptimisticOptions>())

  const socket = ws.subscribe(
    params.topic,
    id,
    (event: NameSpaceServerEventName<T>, data: TopicData<T>) => {
      try {
        if (params.handleMessage) {
          params.handleMessage(event, data)
        }
        if (serverEvents && event in serverEvents) {
          (serverEvents[event] as (data: TopicData<T>) => void)(data)
        }
      }
      catch (error) {
        console.error('Error handling message:', error)
      }
    },
  )

  function emit(...args: Parameters<typeof socket.emit>) {
    socket.emit(...args)
  }

  function optimisticEmit<TState>(
    options: OptimisticOptions<TState>,
    ...args: Parameters<typeof socket.emitWithAck>
  ) {
    const operationId = crypto.randomUUID()
    const timeout = options.timeout ?? 5000

    // Store initial state for potential rollback
    const initialState = JSON.parse(JSON.stringify(options.initialState))

    // Apply optimistic action immediately
    options.action(options.initialState)

    // Store operation for cleanup
    pendingOperations.value.set(operationId, options)

    async function attemptEmit(): Promise<void> {
      const socketWithTimeout = socket.timeout(timeout)

      try {
        const response = await socketWithTimeout.emitWithAck(
          ...(args as Parameters<typeof socketWithTimeout.emitWithAck>),
        ) as AckResponse

        if (response.success) {
          options.onSuccess?.()
        }
        else {
          throw new Error(response.error || 'Server returned unsuccessful response')
        }
      }
      catch (error) {
        const errorResponse: ErrorAckResponse = {
          success: false,
          error: 'Unknown error',
          code: 'ERROR',
          details: error,
        }

        if (options.onError) {
          options.onError(errorResponse, initialState)
        }

        if (options.rollback) {
          options.rollback(initialState)
        }

        throw error
      }
      finally {
        pendingOperations.value.delete(operationId)
      }
    }

    return attemptEmit()
  }

  function cancelPendingOperations(): void {
    pendingOperations.value.clear()
  }

  onUnmounted(() => {
    cancelPendingOperations()
    socket.disconnect()
    ws.unsubscribeStore(id)
  })

  return {
    emit,
    optimisticEmit,
  }
}
