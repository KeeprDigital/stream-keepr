export const defaultEventData: EventData = {
  currentRound: '',
  leftTalent: '',
  rightTalent: '',
  holdingText: '',
}

export const defaultConfigData: ConfigData = {
  tournament: {
    game: 'mtg',
    name: '',
    description: '',
    days: 1,
    swissRounds: 1,
    cutRounds: 0,
    playerCount: 0,
  },
  overlay: {
    matchOrientation: 'horizontal',
  },
  talent: {
    talents: [],
  },
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
  id: '',
  name: '',
  playerOne: defaultPlayerData,
  playerTwo: defaultPlayerData,
  tableNumber: '',
}
