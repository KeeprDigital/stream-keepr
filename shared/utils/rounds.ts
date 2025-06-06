export function getRoundOptions(swissRounds: number, cutRounds: number): string[] {
  const swiss = Array.from({ length: swissRounds }, (_, i) => `Round ${i + 1}`)

  const cutNames = ['Final', 'Semi-Final']

  const cut = Array.from({ length: cutRounds }, (_, i) =>
    cutNames[i] ?? `Top ${2 ** (i + 1)}`).reverse()

  return [...swiss, ...cut]
}

export function isSwissRound(
  roundName: string,
  swissRounds: number,
  cutRounds: number,
): boolean {
  const roundOptions = getRoundOptions(swissRounds, cutRounds)
  const roundIndex = roundOptions.indexOf(roundName)

  if (roundIndex === -1)
    return false

  // Swiss rounds come first in the array, so index < swissRounds means it's a swiss round
  return roundIndex < swissRounds
}

export function getCurrentRoundInfo(
  currentRound: string,
  swissRoundTime: number,
  cutRoundTime: number,
  swissRounds: number,
  cutRounds: number,
): { duration: number, mode: 'countdown' | 'countup', isSwiss: boolean } {
  if (!currentRound) {
    return { duration: 0, mode: 'countdown', isSwiss: false }
  }

  const isSwiss = isSwissRound(currentRound, swissRounds, cutRounds)
  const duration = isSwiss ? swissRoundTime : cutRoundTime
  const mode = duration === 0 ? 'countup' : 'countdown'

  return { duration, mode, isSwiss }
}
