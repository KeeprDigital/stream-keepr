export const durationUtils = {
  minutesToMs: (minutes: number): number => {
    if (minutes < 0)
      throw new Error('Minutes cannot be negative')
    return Math.round(minutes * 60 * 1000)
  },

  msToMinutes: (ms: number): number => {
    if (ms < 0)
      throw new Error('Milliseconds cannot be negative')
    return Math.round(ms / (60 * 1000))
  },

  msToMinutesDecimal: (ms: number, precision: number = 1): number => {
    if (ms < 0)
      throw new Error('Milliseconds cannot be negative')
    return Number((ms / (60 * 1000)).toFixed(precision))
  },

  msToParts: (milliseconds: number) => {
    const totalSeconds = Math.floor(milliseconds / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    const hours = Math.floor(minutes / 60)
    const displayMinutes = minutes % 60

    return {
      hours,
      minutes: displayMinutes,
      seconds,
      totalMinutes: minutes,
      totalSeconds,
      paddedHours: hours.toString().padStart(2, '0'),
      paddedMinutes: displayMinutes.toString().padStart(2, '0'),
      paddedSeconds: seconds.toString().padStart(2, '0'),
      display: hours > 0
        ? `${hours.toString().padStart(2, '0')}:${displayMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        : `${displayMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
    }
  },

  partsToMs: (parts: { hours?: number, minutes: number, seconds: number }): number => {
    const hours = parts.hours || 0
    return durationUtils.minutesToMs(hours * 60 + parts.minutes) + parts.seconds * 1000
  },
}

export const matchClockUtils = {
  getCurrentElapsedTime: (clock: MatchClockData, currentTime: number): number => {
    let totalElapsed = clock.elapsedTime || 0
    if (clock.running && clock.startTime) {
      totalElapsed += currentTime - clock.startTime
    }
    return totalElapsed
  },

  getRemainingTime: (clock: MatchClockData, currentTime: number): number => {
    const currentElapsed = matchClockUtils.getCurrentElapsedTime(clock, currentTime)
    return Math.max(0, clock.totalDuration - currentElapsed)
  },

  isExpired: (clock: MatchClockData, currentTime: number): boolean => {
    return clock.mode === 'countdown' && matchClockUtils.getRemainingTime(clock, currentTime) <= 0
  },
}

export function updateClockState(
  clock: MatchClockData,
  payload: MatchClockActionPayload,
  currentTime: number,
): void {
  const updateElapsedTime = () => {
    if (clock.running && clock.startTime) {
      const sessionTime = currentTime - clock.startTime
      clock.elapsedTime += sessionTime
      clock.startTime = currentTime
    }
  }

  switch (payload.action) {
    case 'start':
      clock.startTime = currentTime
      clock.elapsedTime = 0
      clock.running = true
      break

    case 'pause':
      updateElapsedTime()
      clock.startTime = null
      clock.running = false
      break

    case 'resume':
      clock.startTime = currentTime
      clock.running = true
      break

    case 'reset':
      clock.startTime = null
      clock.elapsedTime = 0
      clock.running = false
      break

    case 'set':
      if (payload.value !== undefined && payload.value > 0) {
        if (clock.mode === 'countdown') {
          clock.totalDuration = payload.value
        }
        clock.running = false
        clock.startTime = null
      }
      break

    case 'adjust':
      if (payload.value !== undefined) {
        updateElapsedTime()

        if (clock.mode === 'countup') {
          clock.elapsedTime = Math.max(0, clock.elapsedTime + payload.value)
        }
        else {
          if (payload.value > 0) {
            clock.totalDuration += payload.value
          }
          else {
            const currentElapsed = matchClockUtils.getCurrentElapsedTime(clock, currentTime)
            const minDuration = Math.max(currentElapsed, 0)
            clock.totalDuration = Math.max(minDuration, clock.totalDuration + payload.value)
          }
        }
      }
      break

    case 'setMode':
      if (payload.mode) {
        clock.mode = payload.mode
        clock.running = false
        clock.startTime = null
        clock.elapsedTime = 0

        if (payload.mode === 'countup') {
          clock.totalDuration = Number.MAX_SAFE_INTEGER
        }
        else if (payload.mode === 'countdown') {
          clock.totalDuration = clock.initialDuration
        }
      }
      break
  }
}
