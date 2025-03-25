export type CardClientAction =
  | 'set'
  | 'clear'
  | 'hide'
  | 'show'
  | 'rotate'
  | 'counterRotate'
  | 'flip'
  | 'turnOver'

export type CardActionPayloadMap = {
  set: CardData
  clear: undefined
  hide: undefined
  show: undefined
  rotate: undefined
  counterRotate: undefined
  flip: undefined
  turnOver: undefined
}

// Define a card message with action
export type CardActionMessage = {
  action: CardClientAction
} & (
  | { action: 'set', card: CardActionPayloadMap['set'] }
  | { action: 'clear' }
  | { action: 'hide' }
  | { action: 'show' }
  | { action: 'rotate' }
  | { action: 'counterRotate' }
  | { action: 'flip' }
  | { action: 'turnOver' }
  )
