import type { OverlayState } from '~/types/overlay'

export default defineEventHandler(async () => {
  const local = useStorage('local')
  const data = await local.getItem<OverlayState>('overlayData')

  if (!data) {
    return null
  }

  const parsed = {
    topPlayer: {
      name: data.topPlayer.name,
      proNouns: data.topPlayer.proNouns,
      deck: data.topPlayer.deck,
      score: data.topPlayer.position
        ? `${data.topPlayer.score.wins} - ${data.topPlayer.score.losses} ${data.topPlayer.score.draws ? `- ${data.topPlayer.score.draws}` : ''}`
        : data.topPlayer.position,
    },
    bottomPlayer: {
      name: data.bottomPlayer.name,
      proNouns: data.bottomPlayer.proNouns,
      deck: data.bottomPlayer.deck,
      score: data.bottomPlayer.position
        ? `${data.bottomPlayer.score.wins} - ${data.bottomPlayer.score.losses} ${data.bottomPlayer.score.draws
          ? `- ${data.bottomPlayer.score.draws}`
          : ''}`
        : data.bottomPlayer.position,
    },
    event: {
      name: data.event.name ? data.event.name : '',
      currentRound: data.event.currentRound ? data.event.currentRound : '',
      leftTalent: data.event.leftTalent ? data.event.leftTalent : '',
      rightTalent: data.event.rightTalent ? data.event.rightTalent : '',
    },
  }

  return [parsed]
})
