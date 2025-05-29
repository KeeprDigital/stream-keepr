export function getRoundOptions(swissRounds: number, cutRounds: number): string[] {
  const swiss = Array.from({ length: swissRounds }, (_, i) => `Round ${i + 1}`)

  const cutNames = ['Final', 'Semi-Final']

  const cut = Array.from({ length: cutRounds }, (_, i) =>
    cutNames[i] ?? `Top ${2 ** (i + 1)}`).reverse()

  return [...swiss, ...cut]
}
