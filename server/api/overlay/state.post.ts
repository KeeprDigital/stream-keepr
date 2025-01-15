import type { OverlayState } from '~/types/overlay'

export default defineEventHandler(async (event) => {
  const { overlay } = await readBody<{ overlay: OverlayState }>(event)

  const local = useStorage('local')
  local.setItem('overlayData', overlay)
  return overlay
})
