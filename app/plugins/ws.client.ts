import type { Socket } from 'socket.io-client'
import { io } from 'socket.io-client'

export default defineNuxtPlugin(() => {
  const storeSubscriptions = reactive(new Map<string, Set<Topic>>())
  const namespaces = reactive(new Map<Topic, NameSpaceClient<Topic>>())

  let mainSocket: Socket<ServerEvents, ClientEvents> | null = null

  function connect() {
    if (mainSocket && mainSocket.connected)
      return

    mainSocket = io()
    mainSocket.on('connect', () => {
      resubscribeToNamespaces()
    })

    mainSocket.on('disconnect', () => {})

    mainSocket.on('connect_error', (error) => {
      console.error(' - Socket.IO connection error - ', error)
    })
  }

  function disconnect() {
    namespaces.forEach((socket) => {
      socket.disconnect()
    })
    namespaces.clear()

    if (mainSocket) {
      mainSocket.disconnect()
      mainSocket = null
    }
  }

  function connectToNamespace<T extends Topic>(topic: T): NameSpaceClient<T> {
    if (namespaces.has(topic)) {
      return namespaces.get(topic) as NameSpaceClient<T>
    }
    const nsSocket: NameSpaceClient<T> = io(`/${topic}`)
    namespaces.set(topic, nsSocket)
    return nsSocket
  }

  function resubscribeToNamespaces() {
    if (!mainSocket || !mainSocket.connected)
      return

    Array.from(namespaces.keys()).forEach((topic) => {
      connectToNamespace(topic)
    })
  }

  function subscribe<T extends Topic>(
    topic: T,
    storeId: string,
    eventCallback: (event: NameSpaceServerEventName<T>, data: TopicData<T>) => void,
  ): NameSpaceClient<T> {
    if (!storeSubscriptions.has(storeId)) {
      storeSubscriptions.set(storeId, new Set())
    }
    storeSubscriptions.get(storeId)!.add(topic)

    const nsSocket = connectToNamespace(topic)

    nsSocket.onAny(eventCallback)

    return nsSocket
  }

  function unsubscribe<T extends Topic>(
    topic: T,
    storeId: string,
    eventCallback?: (event: NameSpaceServerEventName<T>, data: TopicData<T>) => void,
  ): boolean {
    if (storeSubscriptions.has(storeId)) {
      storeSubscriptions.get(storeId)!.delete(topic)

      if (storeSubscriptions.get(storeId)!.size === 0) {
        storeSubscriptions.delete(storeId)
      }
    }

    if (!namespaces.has(topic))
      return false

    const nsSocket = namespaces.get(topic)!

    if (eventCallback) {
      nsSocket.offAny(eventCallback)
    }

    if (!eventCallback) {
      nsSocket.disconnect()
      namespaces.delete(topic)
    }

    return true
  }

  function unsubscribeStore(storeId: string): boolean {
    if (!storeSubscriptions.has(storeId)) {
      return false
    }

    const topics = Array.from(storeSubscriptions.get(storeId)!)
    let success = true

    topics.forEach((topic) => {
      const result = unsubscribe(topic, storeId)
      if (!result)
        success = false
    })

    return success
  }

  function getTopicSocket<T extends Topic>(
    topic: T,
  ): NameSpaceClient<T> {
    if (!namespaces.has(topic)) {
      throw new Error('Not subscribed to namespace')
    }

    const nsSocket = namespaces.get(topic)

    if (!nsSocket || !nsSocket.connected) {
      throw new Error('Namespace not connected')
    }

    return nsSocket as NameSpaceClient<T>
  }

  function isSubscribed<T extends Topic>(topic: T): boolean {
    return namespaces.has(topic) && namespaces.get(topic)!.connected
  }

  function getStoreSubscriptions(storeId: string): (Topic)[] {
    return storeSubscriptions.has(storeId)
      ? Array.from(storeSubscriptions.get(storeId)!)
      : []
  }

  connect()

  const wsService = {
    activeSubscriptions: computed(() => Array.from(namespaces.keys())),
    storeSubscriptions: readonly(storeSubscriptions),

    connect,
    disconnect,
    subscribe,
    unsubscribe,
    unsubscribeStore,
    getTopicSocket,
    isSubscribed,
    getStoreSubscriptions,
  }

  return {
    provide: {
      ws: wsService,
    },
  }
})
