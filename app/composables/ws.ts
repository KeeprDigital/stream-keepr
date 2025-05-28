type OptimisticOptions<TState = any, TResponse = AckResponse, TActionResult = any> = {
  initialState: TState
  action: (initialState: TState) => TActionResult
  onSuccess?: (response: ExtractSuccessResponse<TResponse>, actionResult: TActionResult) => void
  onError?: (error: ErrorAckResponse, initialState: TState) => void
  rollback: (initialState: TState, actionResult: TActionResult) => void
  timeout?: number
}

export type Params<TTopic extends Topic> = {
  topic: TTopic
  actions?: NameSpaceServerEvents<TTopic>
  serverEvents?: NameSpaceServerEvents<TTopic>
  handleMessage?: (event: NameSpaceServerEventName<TTopic>, data: TopicData<TTopic>) => void
  disconnectOnUnmount?: boolean // Default false - connections persist by default
}

export function useWS<TTopic extends Topic = never>(params: Params<TTopic>) {
  const ws = useNuxtApp().$ws ?? (() => {
    throw new Error('Socket plugin not initialized')
  })()

  const serverEvents = params.serverEvents
  const id = useId()

  const pendingOperations = ref(new Map<string, OptimisticOptions<any, any, any>>())

  const socket = ws.subscribe(
    params.topic,
    id,
    (event: NameSpaceServerEventName<TTopic>, data: TopicData<TTopic>) => {
      try {
        if (params.handleMessage) {
          params.handleMessage(event, data)
        }
        if (serverEvents && event in serverEvents) {
          (serverEvents[event] as (data: TopicData<TTopic>) => void)(data)
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

  function optimisticEmit<
    TState,
    TActionResult,
    TEvent extends keyof ClientEventsMap[TTopic],
    TResponse = GetResponseType<TTopic, TEvent>,
  >(
    event: TEvent,
    options: OptimisticOptions<TState, TResponse, TActionResult>,
    ...args: ClientEventParams<TTopic, TEvent>
  ): Promise<void> {
    const operationId = crypto.randomUUID()
    const timeout = options.timeout ?? 5000

    // Store initial state for potential rollback
    const initialState = JSON.parse(JSON.stringify(options.initialState))

    // Apply optimistic action immediately and store the result
    const actionResult = options.action(options.initialState)

    // Store operation for cleanup
    pendingOperations.value.set(operationId, options as OptimisticOptions<any, any, any>)

    async function attemptEmit(): Promise<void> {
      // Check if socket is still connected before attempting to emit
      if (!socket.connected) {
        throw new Error('Socket not connected')
      }

      const socketWithTimeout = socket.timeout(timeout)

      try {
        // @ts-expect-error - Socket.io's types are complex, but this is safe
        const response = await socketWithTimeout.emitWithAck(event, ...args) as TResponse

        if ((response as AckResponse).success) {
          options.onSuccess?.(response as ExtractSuccessResponse<TResponse>, actionResult)
        }
        else {
          throw new Error((response as ErrorAckResponse).error || 'Server returned unsuccessful response')
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
          options.rollback(initialState, actionResult)
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

  // Only disconnect on unmount if explicitly requested
  onUnmounted(() => {
    cancelPendingOperations()
    if (params.disconnectOnUnmount) {
      socket.disconnect()
      ws.unsubscribeStore(id)
    }
  })

  return {
    emit,
    optimisticEmit,
  }
}
