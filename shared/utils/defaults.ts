import type { ConfigData } from '../schemas/config'

export const defaultConfigData: ConfigData = {
  name: '',
  description: '',
  days: 1,
  swissRounds: 1,
  cutRounds: 0,
  playerCount: 0,
  featureMatches: 1,
}

export const defaultPlayerData: PlayerData = {
  name: '',
  proNouns: '',
  deck: '',
  position: '',
  score: {
    wins: 0,
    losses: 0,
    draws: 0,
  },
}

export const defaultMatchData: MatchData = {
  playerOne: defaultPlayerData,
  playerTwo: defaultPlayerData,
  table: '',
}
