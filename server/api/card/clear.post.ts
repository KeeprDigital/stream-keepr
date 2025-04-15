import { processApiCall } from '~~/server/utils/api-handler'

export default defineEventHandler(async () => {
  await processApiCall('card', { action: 'clear' })
})
