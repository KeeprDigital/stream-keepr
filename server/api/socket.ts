import { topicRegistry } from '../socket/registry'

type Client = {
  id: string
  socket: any
  topics: Set<string>
}

// Store for clients and topics
const clients = new Map<string, Client>()
const topics = new Map<string, Set<string>>() // topic -> set of client IDs

export default defineWebSocketHandler({
  open(peer) {
    const clientId = crypto.randomUUID()
    clients.set(clientId, {
      id: clientId,
      socket: peer,
      topics: new Set(),
    })

    sendToClient(peer, createMessage(
      MessageTypes.CONNECTION,
      undefined,
      { clientId },
    ))
  },

  async message(peer, message) {
    try {
      const data = message.json<SocketMessage>()
      const clientId = findClientIdBySocket(peer)

      if (!clientId) {
        sendToClient(peer, createMessage(
          MessageTypes.ERROR,
          undefined,
          { message: 'Client not found', code: 404 },
        ))
        return
      }

      const client = clients.get(clientId)
      if (!client) {
        sendToClient(peer, createMessage(
          MessageTypes.ERROR,
          undefined,
          { message: 'Client not registered', code: 403 },
        ))
        return
      }

      // Validate message type
      if (!isMessageType(data.type)) {
        sendToClient(peer, createMessage(
          MessageTypes.ERROR,
          undefined,
          { message: 'Invalid message type', code: 400 },
        ))
        return
      }

      switch (data.type) {
        case MessageTypes.SUBSCRIBE: {
          if (!data.topic || !isValidTopic(data.topic)) {
            sendToClient(peer, createMessage(
              MessageTypes.ERROR,
              undefined,
              { message: 'Invalid topic', code: 400 },
            ))
            return
          }

          // Add client to topic
          if (!topics.has(data.topic)) {
            topics.set(data.topic, new Set())
          }

          topics.get(data.topic)!.add(clientId)
          client.topics.add(data.topic)

          // Get the topic handler
          const topic = data.topic as Topic
          const handler = topicRegistry[topic]?.onSubscribe

          // Call onSubscribe handler and send initial data if available
          if (handler) {
            try {
              const initialData = await handler()

              sendToClient(peer, createSubscribedMesage(
                topic,
                initialData,
              ))
            }
            catch (error) {
              console.error(`Error in onSubscribe handler for topic ${topic}:`, error)
            }
          }
          break
        }

        case MessageTypes.UNSUBSCRIBE: {
          if (!data.topic || !isValidTopic(data.topic)) {
            sendToClient(peer, createMessage(
              MessageTypes.ERROR,
              undefined,
              { message: 'Invalid topic', code: 400 },
            ))
            return
          }

          // Remove client from topic
          topics.get(data.topic)?.delete(clientId)
          client.topics.delete(data.topic)

          // If topic has no subscribers, clean it up
          if (topics.get(data.topic)?.size === 0) {
            topics.delete(data.topic)
          }

          // Confirm unsubscription
          sendToClient(peer, createMessage(
            MessageTypes.UNSUBSCRIBED,
            data.topic,
            { topic: data.topic },
          ))
          break
        }

        case MessageTypes.PING: {
          sendToClient(peer, createMessage(
            MessageTypes.PONG,
          ))
          break
        }

        case MessageTypes.MESSAGE: {
          // Validate topic and payload exists
          if (!data.topic || !isValidTopic(data.topic) || !data.payload) {
            sendToClient(peer, createMessage(
              MessageTypes.ERROR,
              undefined,
              { message: 'Invalid topic or missing payload', code: 400 },
            ))
            return
          }

          // Check if client is subscribed to the topic
          if (!client.topics.has(data.topic)) {
            sendToClient(peer, createMessage(
              MessageTypes.ERROR,
              undefined,
              { message: 'Not subscribed to topic', code: 403 },
            ))
            return
          }

          // Validate payload using type guard
          const topic = data.topic as Topic

          // Now the handler receives the correctly typed payload
          const handler = topicRegistry[topic]?.onMessage
          if (handler) {
            handler(data.payload)
          }

          // Publish message to all subscribers of the topic
          publishToTopic(topic, createMessage(
            MessageTypes.MESSAGE,
            topic,
            data.payload,
          ))
          break
        }

        default: {
          sendToClient(peer, createMessage(
            MessageTypes.ERROR,
            undefined,
            { message: 'Unsupported message type', code: 400 },
          ))
          break
        }
      }
    }
    catch (error) {
      console.error('Error processing WebSocket message:', error)

      // Send error back to client
      sendToClient(peer, createMessage(
        MessageTypes.ERROR,
        undefined,
        {
          message: 'Failed to process message',
          code: 500,
        },
      ))
    }
  },

  close(peer) {
    const clientId = findClientIdBySocket(peer)
    if (!clientId)
      return

    const client = clients.get(clientId)
    if (!client)
      return

    // Remove client from all subscribed topics
    client.topics.forEach((topic) => {
      topics.get(topic)?.delete(clientId)

      // Clean up empty topics
      if (topics.get(topic)?.size === 0) {
        topics.delete(topic)
      }
    })

    // Remove client
    clients.delete(clientId)
  },
})

// Helper functions
function findClientIdBySocket(socket: any): string | undefined {
  for (const [id, client] of clients.entries()) {
    if (client.socket === socket) {
      return id
    }
  }
  return undefined
}

// Type-safe function to send messages to a client
function sendToClient(
  socket: any,
  message: SocketMessage,
) {
  socket.send(JSON.stringify(message))
}

// Type-safe function to publish to a topic
function publishToTopic<T extends Topic>(
  topic: T,
  message: SocketMessage<TopicMap[T] | null>,
) {
  const subscriberIds = topics.get(topic)
  if (!subscriberIds)
    return

  const messageStr = JSON.stringify(message)

  subscriberIds.forEach((clientId) => {
    const client = clients.get(clientId)
    if (client) {
      client.socket.send(messageStr)
    }
  })
}

// Utility function to publish from other server routes
export function publishMessage<T extends Topic>(
  topic: T,
  payload: TopicMap[T],
) {
  const message: SocketMessage<TopicMap[T]> = {
    type: MessageTypes.MESSAGE,
    topic,
    payload,
  }
  publishToTopic(topic, message)
}

// Utility to get active topics and their subscriber counts
export function getActiveTopics(): Record<string, number> {
  const result: Record<string, number> = {}

  topics.forEach((subscribers, topic) => {
    result[topic] = subscribers.size
  })

  return result
}

// Utility to get active clients and their subscribed topics
export function getActiveClients(): Record<string, string[]> {
  const result: Record<string, string[]> = {}

  clients.forEach((client, id) => {
    result[id] = Array.from(client.topics)
  })

  return result
}
