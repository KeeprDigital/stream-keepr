export const defaultEventSettings: EventSettingsData = {
  matchCount: 3,
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
