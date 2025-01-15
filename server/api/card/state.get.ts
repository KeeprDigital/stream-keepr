import type { SelectedCard } from '~/types/cardData'

export default defineEventHandler(async () => {
  const local = useStorage('local')
  const data = await local.getItem<SelectedCard>('cardData')
  return data
})
