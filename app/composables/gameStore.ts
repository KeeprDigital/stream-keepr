export function useGameStore(game: ConfigGame) {
  const storeMap = {
    mtg: () => useMtgCardStore(),
    op: () => useOpCardStore(),
  } as const

  const store = storeMap[game]
  if (!store) {
    throw new Error(`No store found for game: ${game}`)
  }

  return store()
}
