import type { OverlayState } from '~/types/overlay'

export default defineEventHandler(async () => {
  const local = useStorage('local')
  const data = local.getItem<OverlayState>('overlayData')
  return data
})
