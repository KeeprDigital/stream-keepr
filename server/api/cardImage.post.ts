import type { SelectedCard } from '~/types/cardData'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ card: SelectedCard }>(event)

  const local = useStorage('local')
  local.setItem('cardData', body.card)
  return 'OK'
})
