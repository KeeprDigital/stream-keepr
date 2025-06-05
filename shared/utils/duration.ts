export type DurationMs = {
  readonly value: number
  readonly unit: 'ms'
}

export type DurationMinutes = {
  readonly value: number
  readonly unit: 'minutes'
}

export const duration = {
  /**
   * Convert minutes to milliseconds
   */
  toMs: (minutes: number): number => {
    if (minutes < 0)
      throw new Error('Minutes cannot be negative')
    return Math.round(minutes * 60 * 1000)
  },

  /**
   * Convert milliseconds to minutes
   */
  toMinutes: (ms: number): number => {
    if (ms < 0)
      throw new Error('Milliseconds cannot be negative')
    return Math.round(ms / (60 * 1000))
  },

  /**
   * Convert milliseconds to minutes with decimal precision
   */
  toMinutesDecimal: (ms: number, precision: number = 1): number => {
    if (ms < 0)
      throw new Error('Milliseconds cannot be negative')
    return Number((ms / (60 * 1000)).toFixed(precision))
  },
}
