export type TimeServerEvents = {
  syncResponse: (response: TimeSyncResponse) => void
  timeUpdate: (update: TimeUpdate) => void
}

export type TimeClientEvents = {
  syncRequest: (timestamp: number) => void
}

export type TimeSyncResponse = {
  clientTimestamp: number
  serverTime: number
  serverProcessingTime: number
}

export type TimeUpdate = {
  timestamp: number
  iso: string
}
