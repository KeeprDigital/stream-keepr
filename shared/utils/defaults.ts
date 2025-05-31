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
    cardTimeout: 0,
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

export const defaultMatchData: MatchData = {
  id: '',
  name: '',
  playerOne: defaultPlayerData,
  playerTwo: defaultPlayerData,
  tableNumber: '',
}

export const defaultMtgCardData: MtgCardData = {
  name: '',
  set: '',
  layout: 'normal',
  imageData: {
    front: null,
    back: null,
  },
  displayData: {
    hidden: true,
    flipped: false,
    turnedOver: false,
    rotated: false,
    counterRotated: false,
  },
  orientationData: {
    flipable: false,
    turnable: false,
    rotateable: false,
    counterRotateable: false,
  },
  points: 0,
}
