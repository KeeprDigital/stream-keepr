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
  rotatable: boolean
  counterRotatable: boolean
}> = {
  preview: {
    animated: true,
    turnoverable: false,
    selectable: false,
    rotatable: true,
    counterRotatable: true,
  },
  output: {
    animated: true,
    turnoverable: false,
    selectable: false,
    rotatable: true,
    counterRotatable: true,
  },
  list: {
    animated: true,
    turnoverable: true,
    selectable: true,
    rotatable: false,
    counterRotatable: false,
  },
  history: {
    animated: false,
    turnoverable: false,
    selectable: true,
    rotatable: false,
    counterRotatable: false,
  },
}
