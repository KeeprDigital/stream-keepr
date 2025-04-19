import { processApiCall } from '~~/server/utils/api-handler'
import { isValidTopic } from '~~/shared/utils/socket'

export default defineEventHandler(async (event) => {
  try {
    const topicParam = getRouterParam(event, 'topic')
    const action = getRouterParam(event, 'action')
    const body = await readBody(event)

    if (!topicParam || !isValidTopic(topicParam)) {
      throw createError({
        statusCode: 400,
        message: 'Invalid topic',
      })
    }

    const topic = topicParam

    const apiCall = { action, ...body }

    const result = await processApiCall(topic, apiCall)

    return { success: true, data: result }
  }
  catch (error) {
    console.error('Error in topic API:', error)
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})
