export const defaultEventData: EventData = {
  currentDay: '',
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
    eventMode: 'tournament',
    defaultClockDuration: 3000000, // 50 minutes in milliseconds
    defaultClockMode: 'countdown',
    swissRounds: 1,
    swissRoundTime: 0,
    cutRounds: 0,
    cutRoundTime: 0,
    playerCount: 0,
  },
  overlay: {
    matchOrientation: 'horizontal',
    cardTimeout: 0,
    cardSize: 300,
    clearPreviewOnShow: false,
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

export const defaultOpCardData: OpCardData = {
  id: '',
  code: '',
  rarity: '',
  type: '',
  name: '',
  cost: 0,
  power: null,
  counter: null,
  color: '',
  family: '',
  ability: '',
  trigger: '',
  set_name: '',
  image_url: '',
  attribute_name: '',
}

export const defaultMatchData: MatchData = {
  id: '',
  name: '',
  tableNumber: '',
  playerOne: defaultPlayerData,
  playerTwo: defaultPlayerData,
  clock: undefined,
}

export function createDefaultMatch(params: {
  id: string
  name: string
}): MatchData {
  return {
    ...defaultMatchData,
    playerOne: { ...defaultPlayerData },
    playerTwo: { ...defaultPlayerData },
    ...params,
  }
}

export function createMatchClock(durationMs: number): MatchClockData {
  return {
    totalDuration: durationMs,
    initialDuration: durationMs,
    running: false,
    elapsedTime: 0,
    startTime: null,
    mode: 'countdown',
  }
}
