const channel = 'OVERLAY'

export default defineWebSocketHandler({
  async open(peer) {
    const local = useStorage('local')
    const card = await local.getItem<CardData>('card')
    const display = await local.getItem<CardDisplayData>('cardDisplay')

    if (card && display) {
      peer.send(createServerMessage('card', { 
        card,
        display,
      }))
    }

    const event = await local.getItem<EventData>('event')
    if (event) {
      peer.send(createServerMessage('event', {
        event,
      }))
    }

    const player = await local.getItem<PlayersData>('player')
    if (player) {
      peer.send(createServerMessage('player', {
        players: player,
      }))
    }

    peer.subscribe(channel)
  },

  async message(peer, message) {
    const local = useStorage('local')
    const data = message.json() as WebSocketMessage<keyof Payload>

    if (isClientCardMessage(data)) {
      switch (data.payload.action) {
        case 'set':
          await local.setItem('card', data.payload.card)
          await local.setItem('cardDisplay', initialCardDisplay(data.payload.card))
          break
        case 'clear':
          await local.removeItem('card')
          await local.removeItem('cardDisplay')
          break
        case 'hide': {
          const display = await local.getItem<CardDisplayData>('cardDisplay')
          await local.setItem('cardDisplay', {
            ...display,
            hidden: true,
          })
          break
        }
        case 'show': {
          const display = await local.getItem<CardDisplayData>('cardDisplay')
          await local.setItem('cardDisplay', {
            ...display,
            hidden: false,
          })
          break
        }
        case 'rotate': {
          const display = await local.getItem<CardDisplayData>('cardDisplay')
          if (display) {
            await local.setItem('cardDisplay', {
              ...display,
              rotated: !display.rotated,
            })
          }
          break
        }
        case 'counterRotate': {
          const display = await local.getItem<CardDisplayData>('cardDisplay')
          if (display) {
            await local.setItem('cardDisplay', {
              ...display,
              counterRotated: !display.counterRotated,
            })
          }
          break
        }
        case 'flip': {
          const display = await local.getItem<CardDisplayData>('cardDisplay')
          if (display) {
            await local.setItem('cardDisplay', {
              ...display,
              flipped: !display.flipped,
            })
          }
          break
        }
        case 'turnOver': {
          const display = await local.getItem<CardDisplayData>('cardDisplay')
          if (display) {
            await local.setItem('cardDisplay', {
              ...display,
              turnedOver: !display.turnedOver,
            })
          }
        }
      }

      const card = await local.getItem<CardData>('card')
      const display = await local.getItem<CardDisplayData>('cardDisplay')

      peer.publish(channel, createServerMessage('card', {
        card,
        display,
      }))
    }
    else if (isClientEventMessage(data)) {
      await local.setItem('event', data.payload.event)

      peer.publish(channel, createServerMessage('event', {
        event: data.payload.event,
      }))
    }
    else if (isClientPlayerMessage(data)) {
      await local.setItem('player', data.payload.players)

      peer.publish(channel, createServerMessage('player', {
        players: data.payload.players,
      }))
    }
  },

  close(peer) {
    peer.unsubscribe(channel)
  },
})
