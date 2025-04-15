import type { SocketMessage, TopicData, TopicMap } from '~~/shared/schemas/socket'
import { MessageTypes } from '~~/shared/schemas/socket'

export default defineNuxtPlugin(() => {
  // State
  const clientId = ref<string | null>(null)
  const lastError = ref<string | null>(null)

  // Updated to store both message and subscription callbacks
  const topicSubscriptions = reactive(new Map<keyof TopicMap, {
    messageCallbacks: Set<(data: any) => void>
    subscriptionCallbacks: Set<(data: any) => void>
  }>())

  const componentSubscriptions = reactive(new Map<string, Set<keyof TopicMap>>())

  const {
    status,
    data,
    send,
    open,
    close,
  } = useWebSocket(`ws://${window.location.host}/api/socket`, {
    autoReconnect: {
      retries: 5,
      delay: 1000,
      onFailed() {
        lastError.value = 'WebSocket reconnection failed after multiple attempts'
      },
    },
    heartbeat: {
      message: JSON.stringify({ type: 'ping' }),
      interval: 30000,
      pongTimeout: 10000,
    },
    onConnected() {
      if (!clientId.value) {
        clientId.value = `client-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`
      }
      resubscribeToTopics()
    },
    onError(error) {
      lastError.value = 'WebSocket error occurred'
      console.error('WebSocket error:', error)
    },
  })

  // Watch for incoming messages using the data property
  watch(data, (newData) => {
    if (!newData)
      return

    try {
      const message = JSON.parse(newData) as SocketMessage

      switch (message.type) {
        case MessageTypes.sync:
          if (message.topic && isValidTopic(message.topic)) {
            // Route message to topic subscribers
            const subscription = topicSubscriptions.get(message.topic)
            if (subscription) {
              subscription.messageCallbacks.forEach(callback => callback(message.payload))
            }
          }
          break

        case MessageTypes.subscribed:
          if (message.topic && isValidTopic(message.topic)) {
            const subscription = topicSubscriptions.get(message.topic)
            if (subscription) {
              // Notify subscription callbacks of successful subscription
              subscription.subscriptionCallbacks.forEach(callback => callback(message.payload))
            }
          }
          break

        case MessageTypes.error:
          if (message.payload && typeof message.payload === 'object' && 'message' in message.payload) {
            lastError.value = message.payload.message as string
            console.error('WebSocket error from server:', message.payload)
          }
          break
      }
    }
    catch (error) {
      console.error('Error processing message:', error)
    }
  })

  // Computed properties
  const isConnected = computed(() => status.value === 'OPEN')
  const activeSubscriptions = computed(() => Array.from(topicSubscriptions.keys()))

  // Resubscribe to all topics (used after reconnection)
  function resubscribeToTopics() {
    if (!isConnected.value)
      return

    topicSubscriptions.forEach((_, topic) => {
      sendToServer({
        type: MessageTypes.subscribe,
        topic: topic as string,
      })
    })
  }

  // Send message to server
  function sendToServer(message: SocketMessage): boolean {
    if (!isConnected.value) {
      console.error('WebSocket not connected')
      return false
    }

    send(JSON.stringify(message))
    return true
  }

  // Subscribe to a topic with component tracking
  function subscribe<T extends keyof TopicMap>(
    topic: T,
    componentId: string,
    messageCallback: (data: TopicData<T>) => void,
    subscriptionCallback?: (data: TopicData<T>) => void,
  ): boolean {
    // Track component subscription
    if (!componentSubscriptions.has(componentId)) {
      componentSubscriptions.set(componentId, new Set())
    }
    componentSubscriptions.get(componentId)!.add(topic)

    // Register callbacks
    if (!topicSubscriptions.has(topic)) {
      topicSubscriptions.set(topic, {
        messageCallbacks: new Set(),
        subscriptionCallbacks: new Set(),
      })

      // Send subscription request to server if connected
      if (isConnected.value) {
        sendToServer({
          type: MessageTypes.subscribe,
          topic: topic as string,
        })
      }
    }

    topicSubscriptions.get(topic)!.messageCallbacks.add(messageCallback as any)

    // Add subscription callback if provided
    if (subscriptionCallback) {
      topicSubscriptions.get(topic)!.subscriptionCallbacks.add(subscriptionCallback)
    }

    return true
  }

  // Unsubscribe from a topic with component tracking
  function unsubscribe<T extends keyof TopicMap>(
    topic: T,
    componentId: string,
    messageCallback?: (data: TopicMap[T]) => void,
    subscriptionCallback?: (data: TopicData<T> | null) => void,
  ): boolean {
    // Validate topic
    if (!isValidTopic(topic)) {
      console.error('Invalid topic:', topic)
      return false
    }

    // Update component subscriptions
    if (componentSubscriptions.has(componentId)) {
      componentSubscriptions.get(componentId)!.delete(topic)

      // If no more subscriptions, clean up
      if (componentSubscriptions.get(componentId)!.size === 0) {
        componentSubscriptions.delete(componentId)
      }
    }

    if (!topicSubscriptions.has(topic))
      return false

    const subscription = topicSubscriptions.get(topic)!

    if (messageCallback) {
      // Remove specific message callback
      subscription.messageCallbacks.delete(messageCallback as any)
    }

    if (subscriptionCallback) {
      // Remove specific subscription callback
      subscription.subscriptionCallbacks.delete(subscriptionCallback)
    }

    // If no more callbacks, unsubscribe from topic
    if (subscription.messageCallbacks.size === 0) {
      topicSubscriptions.delete(topic)

      if (isConnected.value) {
        sendToServer({
          type: MessageTypes.unsubscribe,
          topic: topic as string,
        })
      }
    }

    return true
  }

  // Unsubscribe a component from all topics
  function unsubscribeComponent(componentId: string): boolean {
    if (!componentSubscriptions.has(componentId)) {
      return false
    }

    const topics = Array.from(componentSubscriptions.get(componentId)!)
    let success = true

    // Unsubscribe from each topic
    topics.forEach((topic) => {
      const result = unsubscribe(topic, componentId)
      if (!result)
        success = false
    })

    return success
  }

  // Publish a message to a topic
  function publish<T extends keyof TopicMap>(
    topic: T,
    payload: TopicMap[T],
  ): boolean {
    // Validate topic
    if (!isValidTopic(topic)) {
      console.error('Invalid topic:', topic)
      return false
    }

    return sendToServer({
      type: MessageTypes.action,
      topic: topic as string,
      payload,
    })
  }

  // Check if subscribed to a topic
  function isSubscribed<T extends keyof TopicMap>(topic: T): boolean {
    return topicSubscriptions.has(topic)
  }

  // Get subscriber count for a topic
  function getSubscriberCount<T extends keyof TopicMap>(topic: T): number {
    return topicSubscriptions.has(topic)
      ? topicSubscriptions.get(topic)!.messageCallbacks.size
      : 0
  }

  // Get topics a component is subscribed to
  function getComponentSubscriptions(componentId: string): (keyof TopicMap)[] {
    return componentSubscriptions.has(componentId)
      ? Array.from(componentSubscriptions.get(componentId)!)
      : []
  }

  // Connect to WebSocket server
  function connect() {
    if (!isConnected.value) {
      open()
    }
  }

  // Disconnect from WebSocket server
  function disconnect() {
    if (isConnected.value) {
      close()
    }
  }

  // Create the websocket service
  const websocketService = {
    // State
    isConnected,
    clientId,
    lastError,
    activeSubscriptions,
    componentSubscriptions: readonly(componentSubscriptions),

    // WebSocket status and data from Vue/Use
    status,
    lastMessage: data,

    // Methods
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    unsubscribeComponent,
    publish,
    isSubscribed,
    getSubscriberCount,
    getComponentSubscriptions,
  }

  return {
    provide: {
      socket: websocketService,
    },
  }
})
