import type { ScryfallFormat } from '@scryfall/api-types'

export const mtgSets: {
  value: ScryfallFormat | 'all' | 'token'
  label: string
}[] = [
  { value: 'all', label: 'All' },
  { value: 'standard', label: 'Standard' },
  { value: 'pioneer', label: 'Pioneer' },
  { value: 'modern', label: 'Modern' },
  { value: 'legacy', label: 'Legacy' },
  { value: 'pauper', label: 'Pauper' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'commander', label: 'Commander' },
  { value: 'token', label: 'Token' },
] as const

export type MtgFormat = (typeof mtgSets)[number]['value']
export type MtgCardDisplayMode = 'preview' | 'output' | 'list' | 'history'

export const mtgCardDisplayModes: Record<MtgCardDisplayMode, {
  animated: boolean
  turnoverable: boolean
  selectable: boolean
  transition: boolean
}> = {
  preview: {
    animated: true,
    turnoverable: false,
    selectable: false,
    transition: false,
  },
  output: {
    animated: true,
    turnoverable: false,
    selectable: false,
    transition: true,
  },
  list: {
    animated: true,
    turnoverable: true,
    selectable: true,
    transition: false,
  },
  history: {
    animated: false,
    turnoverable: false,
    selectable: true,
    transition: false,
  },
}
