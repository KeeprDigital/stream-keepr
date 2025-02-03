import type { H3Event } from 'h3'

export function getPublicAssetURL(event: H3Event): string {
  const requestURL = getRequestURL(event)
  const headers = getRequestHeaders(event)

  const protocol = headers['x-forwarded-proto'] || requestURL.protocol.replace(':', '')
  const host = headers['x-forwarded-host'] || headers.host || requestURL.host

  return `${protocol}://${host}`
}
