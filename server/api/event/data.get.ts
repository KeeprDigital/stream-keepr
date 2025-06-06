export default defineEventHandler(async () => {
  const eventData = await getStore('event')
  return [eventData]
})
