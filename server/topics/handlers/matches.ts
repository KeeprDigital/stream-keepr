import type { MatchApiCall, MatchData } from '~~/shared/schemas/matches'
import type { TopicMap } from '~~/shared/schemas/socket'
import { defaultMatchData } from '~~/shared/utils/defaults'

export async function matchSubscribeHandler() {
  return await useStorage('local').getItem<MatchData[]>('matches') ?? []
}

export async function matchApiCallHandler(_request: MatchApiCall) {
  const localStorage = useStorage('local')
  const localMatches = await localStorage.getItem<MatchData[]>('matches')

  if (!localMatches) {
    return null
  }

  return localMatches
}

export async function matchHandler(message: TopicMap['matches']) {
  const localStorage = useStorage('local')
  const localMatches = await localStorage.getItem<MatchData[]>('matches') ?? []

  switch (message.action) {
    case 'add':
      localMatches.push({
        ...defaultMatchData,
        id: crypto.randomUUID(),
      })
      await localStorage.setItem('matches', localMatches)
      return localMatches
    case 'remove': {
      const index = localMatches.findIndex(match => match.id === message.id)
      if (index !== -1) {
        localMatches.splice(index, 1)
      }
      await localStorage.setItem('matches', localMatches)
      return localMatches
    }
    case 'set': {
      const index = localMatches.findIndex(match => match.id === message.id)
      if (index !== -1) {
        localMatches[index] = message
      }
      await localStorage.setItem('matches', localMatches)
      return localMatches
    }
  }
}
