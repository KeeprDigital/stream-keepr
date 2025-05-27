export type BaseAckResponse = {
  success: boolean
  timestamp?: number
}

export type SuccessAckResponse = {
  success: true
} & BaseAckResponse

export type ErrorAckResponse = {
  success: false
  error: string
  code?: string
  details?: any
} & BaseAckResponse

export type AckResponse = SuccessAckResponse | ErrorAckResponse
export type AckCallback = (response: AckResponse) => void

export type AddAckToActions<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: [...A, ack: AckCallback]) => R
    : T[K]
}
