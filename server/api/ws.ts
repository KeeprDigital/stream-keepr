import type { CardData, CardDisplayData } from '~/types/cardData'
import type { WebSocketMessage } from '~/types/websocket'
import { initialCardDisplay } from '~/utils/parseCard'

const channel = 'OVERLAY'

export default defineWebSocketHandler({
  async open(peer) {
    const local = useStorage('local')
    const card = await local.getItem<CardData>('card')
    const display = await local.getItem<CardDisplayData>('cardDisplay')

    peer.send(JSON.stringify({
      type: 'serverCard',
      payload: {
        card,
        display,
      },
    }))

    peer.subscribe(channel)
  },

  async message(peer, message) {
    const local = useStorage('local')

    const data: WebSocketMessage = message.json()

    if (data.type === 'card') {
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
    }

    peer.publish(channel, JSON.stringify({
      type: 'serverCard',
      payload: {
        card: await local.getItem<CardData>('card'),
        display: await local.getItem<CardDisplayData>('cardDisplay'),
      },
    }))
  },

  close(peer) {
    peer.unsubscribe(channel)
  },
})
