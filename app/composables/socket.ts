export function useSocket() {
  const socket = useNuxtApp().$socket

  if (!socket) {
    throw new Error('Socket plugin not initialized')
  }

  return {
    // State
    isConnected: socket.isConnected,
    clientId: socket.clientId,
    lastError: socket.lastError,
    activeSubscriptions: socket.activeSubscriptions,
    componentSubscriptions: socket.componentSubscriptions,
    status: socket.status,
    lastMessage: socket.lastMessage,

    // Methods
    connect: socket.connect,
    disconnect: socket.disconnect,
    subscribe: socket.subscribe,
    unsubscribe: socket.unsubscribe,
    unsubscribeComponent: socket.unsubscribeComponent,
    publish: socket.publish,
    isSubscribed: socket.isSubscribed,
    getSubscriberCount: socket.getSubscriberCount,
    getComponentSubscriptions: socket.getComponentSubscriptions,
  }
}
