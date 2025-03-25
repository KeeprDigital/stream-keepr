export type ConfigClientAction =
  | 'set'
  | 'clear'

export type ConfigActionPayloadMap = {
  set: ConfigData
  clear: undefined
}

// Define a card message with action
export type ConfigActionMessage = {
  action: ConfigClientAction
} & (
  | { action: 'set', config: ConfigActionPayloadMap['set'] }
  | { action: 'clear' }
  )
