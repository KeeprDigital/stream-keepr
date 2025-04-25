import type { MatchDataList } from '~~/shared/schemas/matches'

export default defineEventHandler(async () => {
  const local = useStorage('local')
  const matchData = await local.getItem<MatchDataList>('matches')

  return matchData
})
