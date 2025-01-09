import type { ScryfallFormat } from '@scryfall/api-types'

export const mtgSets: {
  value: ScryfallFormat | 'all'
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
]
