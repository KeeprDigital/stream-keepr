/**
 * Type guard for topics
 * @param topic - The topic to check
 * @returns True if the topic is a valid topic, false otherwise
 */
export function isValidTopic(topic: string): topic is Topic {
  return Object.values(Topics).includes(topic as Topic)
}

/**
 * Type guard for message types
 * @param type - The type to check
 * @returns True if the type is a valid message type, false otherwise
 */
export function isMessageType(type: string): type is MessageType {
  return Object.values(MessageTypes).includes(type as any)
}

/**
 * Create a type-safe message
 * @param type - The type of the message
 * @param topic - The topic of the message
 * @param payload - The payload of the message
 * @returns The message
 */
export function createMessage<
  T extends MessageType,
  K extends Topic | undefined = undefined,
>(
  type: T,
  topic?: K,
  payload?: K extends Topic ? PayloadType<T, K> : any,
): SocketMessage<K extends Topic ? PayloadType<T, K> : any> {
  return {
    type,
    topic,
    payload,
  }
}

/**
 * Create a type-safe subscribed message
 * @param topic - The topic of the message
 * @param payload - The payload of the message
 * @returns The message
 */
export function createSubscribedMesage<K extends Topic>(
  topic: K,
  payload?: TopicData<K> | null,
): SocketMessage<TopicData<K> | null> {
  return {
    type: MessageTypes.SUBSCRIBED,
    topic,
    payload,
  }
}
