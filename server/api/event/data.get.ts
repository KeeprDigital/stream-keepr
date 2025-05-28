export default defineEventHandler(async () => {
  const local = useStorage('local')
  const eventData = await local.getItem<EventData>('event')

  if (!eventData) {
    return defaultEventData
  }

  return [eventData]
})
