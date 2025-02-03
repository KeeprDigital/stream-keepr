import type { OverlayState } from '~/types/overlay'

export default defineEventHandler(async () => {
  const local = useStorage('local')
  const data = await local.getItem<OverlayState>('overlayData')

  if (!data) {
    return null
  }

  const topRecord = `${data.topPlayer.score.wins}-${data.topPlayer.score.losses}${data.topPlayer.score.draws ? `-${data.topPlayer.score.draws}` : ''}`
  const topScore = data.topPlayer.position ? data.topPlayer.position : topRecord

  const bottomRecord = `${data.bottomPlayer.score.wins}-${data.bottomPlayer.score.losses}${data.bottomPlayer.score.draws ? `-${data.bottomPlayer.score.draws}` : ''}`
  const bottomScore = data.bottomPlayer.position ? data.bottomPlayer.position : bottomRecord

  const parsed = {
    topPlayer: {
      name: data.topPlayer.name,
      proNouns: data.topPlayer.proNouns,
      deck: data.topPlayer.deck,
      headsUp: `${data.topPlayer.name} (${topScore})`,
      score: topScore,
    },
    bottomPlayer: {
      name: data.bottomPlayer.name,
      proNouns: data.bottomPlayer.proNouns,
      deck: data.bottomPlayer.deck,
      headsUp: `${data.bottomPlayer.name} (${bottomScore})`,
      score: bottomScore,
    },
    event: {
      name: data.event.name ? data.event.name : '',
      currentRound: data.event.currentRound ? data.event.currentRound : '',
      holdingText: data.event.holdingText ? data.event.holdingText : '',
      leftTalent: data.event.leftTalent ? data.event.leftTalent : '',
      rightTalent: data.event.rightTalent ? data.event.rightTalent : '',
    },
  }

  return [parsed]
})
