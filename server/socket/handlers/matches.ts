export const matchesHandler: NamespaceHandler<'matches'> = (namespace) => {
  namespace.on('connection', async (socket) => {
    socket.emit('connected', await getStore('matches') ?? [])

    socket.on('add', async (ack) => {
      const matches = await getStore('matches') ?? []
      const config = await getStore('config')
      const event = await getStore('event')

      let clock: MatchClockData | undefined

      if (config?.tournament.eventMode === 'manual') {
        // Manual mode: Use configured default clock settings
        const defaultDuration = config.tournament.defaultClockDuration || 0
        const defaultMode = config.tournament.defaultClockMode || 'countdown'
        clock = {
          ...createMatchClock(defaultDuration),
          mode: defaultMode,
          totalDuration: defaultMode === 'countup' ? Number.MAX_SAFE_INTEGER : defaultDuration,
        }
      }
      else if (config?.tournament.eventMode === 'tournament' && event?.currentRound) {
        // Tournament mode: Use round-based configuration
        const roundInfo = getCurrentRoundInfo(
          event.currentRound,
          config.tournament.swissRoundTime,
          config.tournament.cutRoundTime,
          config.tournament.swissRounds,
          config.tournament.cutRounds,
        )
        clock = {
          ...createMatchClock(roundInfo.duration),
          mode: roundInfo.mode,
          totalDuration: roundInfo.mode === 'countup' ? Number.MAX_SAFE_INTEGER : roundInfo.duration,
        }
        console.log('Round info:', roundInfo)
      }

      const newMatch = {
        ...defaultMatchData,
        id: crypto.randomUUID(),
        name: `Match ${matches.length + 1}`,
        clock,
      }
      matches.push(newMatch)
      setStore('matches', matches)
      ack({
        success: true,
        matchId: newMatch.id,
        matchName: newMatch.name,
        clock: newMatch.clock,
      })
      namespace.except(socket.id).emit('sync', matches)
    })

    socket.on('remove', async (id, ack) => {
      const matches = await getStore('matches')
      if (matches) {
        matches.splice(matches.findIndex(match => match.id === id), 1)
        setStore('matches', matches)
        ack({
          success: true,
          timestamp: Date.now(),
        })
        namespace.except(socket.id).emit('sync', matches)
      }
    })

    socket.on('set', async (matchData, ack) => {
      const matches = await getStore('matches') ?? []
      const matchIndex = matches.findIndex(m => m.id === matchData.id)

      if (matchIndex !== -1) {
        matches[matchIndex] = matchData
        setStore('matches', matches)
        ack({
          success: true,
          timestamp: Date.now(),
        })
        namespace.except(socket.id).emit('sync', matches)
      }
    })

    socket.on('clock', async (payload, ack) => {
      try {
        const matches = await getStore('matches') ?? []
        const match = matches.find(m => m.id === payload.id)

        if (!match) {
          ack({
            success: false,
            error: 'Match not found',
            timestamp: Date.now(),
          })
          return
        }

        if (!match.clock) {
          ack({
            success: false,
            error: 'Match has no clock',
            timestamp: Date.now(),
          })
          return
        }

        // Apply the clock state change
        const timestamp = Date.now()
        updateClockState(match.clock, payload, timestamp)

        // Save to persistent storage
        await setStore('matches', matches)

        // Respond to sender
        ack({
          success: true,
          timestamp,
        })

        // Broadcast updated matches to all other clients
        namespace.except(socket.id).emit('sync', matches)

        console.log(`Clock action '${payload.action}' applied to match ${payload.id}`)
      }
      catch (error) {
        console.error('Error processing clock action:', error)
        ack({
          success: false,
          error: 'Internal server error',
          timestamp: Date.now(),
        })
      }
    })
  })
}
