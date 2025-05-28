export const useMatchStore = defineStore('Match', () => {
  const toast = useToast()
  const formData = ref<MatchData[]>([])
  const state = shallowRef<MatchData[]>([])

  const { optimisticEmit } = useWS({
    topic: 'matches',
    serverEvents: {
      connected: data => state.value = data,
      sync: data => state.value = data,
    },
  })

  watch(state, (newVal) => {
    formData.value = structuredClone(toRaw(newVal))
  })

  // const isDirty = computed(() => {
  //   return JSON.stringify(state.value) !== JSON.stringify(formData.value)
  // })

  function addMatch() {}

  function removeMatch(id: string) {}

  async function saveMatch(id: string) {}

  function updateMatch(updatedMatch: MatchData) {}

  return {
    formData,
    // isDirty,
    saveMatch,
    addMatch,
    removeMatch,
    updateMatch,
  }
})
