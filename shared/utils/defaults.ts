import type { ConfigData } from '../schemas/config'
import type { EventData } from '../schemas/event'
import type { MatchData } from '../schemas/matches'
import type { PlayerData } from '../schemas/player'

export const defaultEventData: EventData = {
  currentRound: '',
  leftTalent: '',
  rightTalent: '',
  holdingText: '',
}

export const defaultConfigData: ConfigData = {
  name: '',
  description: '',
  days: 1,
  swissRounds: 1,
  cutRounds: 0,
  playerCount: 0,
  game: 'mtg',
}

export function defaultPlayerData(): PlayerData {
  return {
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
}

export const defaultMatchData: MatchData = {
  id: '',
  name: '',
  playerOne: defaultPlayerData(),
  playerTwo: defaultPlayerData(),
  tableNumber: '',
}
