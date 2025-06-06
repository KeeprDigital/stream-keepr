export default defineEventHandler(async () => {
  const matchData = await getStore('matches')

  if (matchData) {
    matchData.forEach((match) => {
      if (!match.playerOne.position) {
        match.playerOne.position = `${match.playerOne.score.wins}-${match.playerOne.score.losses}${match.playerOne.score.draws > 0 ? `-${match.playerOne.score.draws}` : ''}`
      }
      if (!match.playerTwo.position) {
        match.playerTwo.position = `${match.playerTwo.score.wins}-${match.playerTwo.score.losses}${match.playerTwo.score.draws > 0 ? `-${match.playerTwo.score.draws}` : ''}`
      }
    })
  }

  return matchData
})
