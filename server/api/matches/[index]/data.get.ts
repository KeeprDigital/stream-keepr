import type { MatchDataList } from '~~/shared/schemas/matches'

export default defineEventHandler(async (event) => {
  const local = useStorage('local')
  const matchData = await local.getItem<MatchDataList>('matches')
  const index = getRouterParam(event, 'index')
  if (!index || !matchData) {
    return null
  }

  const indexNumber = Number(index)

  if (indexNumber < 0 || indexNumber >= matchData.length) {
    return null
  }

  return matchData[indexNumber]
})
