import type { EventData } from '~/types/eventData'

export default defineEventHandler(async () => {
  const local = useStorage('local')
  const event = await local.getItem<EventData>('event')

  if (!event) {
    return null
  }

  const parsed = {
    event: {
      name: event.name,
      currentRound: event.currentRound,
      holdingText: event.holdingText,
      leftTalent: event.leftTalent,
      rightTalent: event.rightTalent,
    },
  }

  return [parsed]
})
