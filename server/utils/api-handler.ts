// server/utils/api-handler.ts
import type { Topic, TopicApiCallMap, TopicData } from '~~/shared/schemas/socket'
import { publishMessage } from '../api/socket'
import { topicRegistry } from '../topics/registry'

/**
 * Processes an API call for a specific topic and publishes the result to all subscribers
 *
 * @param topic The topic to call the API function for
 * @param apiCall The API call payload
 * @returns The result of the API call
 */
export async function processApiCall<T extends Topic>(
  topic: T,
  apiCall: TopicApiCallMap[T],
): Promise<TopicData<T>> {
  try {
    // Get the handler for this topic
    const handler = topicRegistry[topic]?.onApiCall

    if (!handler) {
      throw new Error(`No API handler registered for topic: ${topic}`)
    }

    // Call the handler with the API call payload
    const result = await handler(apiCall)

    // Publish the result to all subscribers
    publishMessage(topic, result)

    // Return the result for API usage
    return result
  }
  catch (error) {
    console.error(`Error processing API call for topic ${topic}:`, error)
    throw error
  }
}
