export type PlayersData = {
  playerOne: PlayerData
  playerTwo: PlayerData
}

export type PlayerData = {
  name: string
  proNouns: string
  deck: string
  position: string
  score: {
    wins: number
    losses: number
    draws: number
  }
}
