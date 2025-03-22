import { defineStore } from 'pinia'

export const useMatchStore = defineStore('Match', () => {
  const matches = ref<MatchData[]>([])

  return {
    matches,
  }
})
