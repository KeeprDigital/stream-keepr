export function eventRealtimeChannel(eventId: number): string {
	return `event:${eventId}`;
}

export function screenRealtimeChannel(eventId: number, screenId: number): string {
	return `screen:${eventId}:${screenId}`;
}

/** Wildcard capability pattern covering every Screen channel of one Event. */
export function screenChannelWildcard(eventId: number): string {
	return `screen:${eventId}:*`;
}

/**
 * The realtime identity a Screen Output connects as (#397).
 *
 * Here rather than in the route that mints it, because this file owns how realtime
 * names things and the route already imports it for the channels. Legible on
 * purpose: it appears in Ably's own dashboards and in presence, where "which Screen
 * is this" is the only question anybody asks of it.
 *
 * A signed-in operator connects as their userId instead, which needs no helper —
 * Better Auth already owns that name. Both replace the `'*'` the token used to
 * grant, which let a holder claim any identity on the channels it was granted.
 */
export function screenOutputRealtimeClientId(screenId: number): string {
	return `screen-output:${screenId}`;
}

/**
 * The Event a realtime channel belongs to, or null for unrecognized shapes.
 * Every channel built above encodes its Event; the transport uses this to
 * scope its token without callers passing the Event separately.
 */
export function realtimeChannelEventId(channel: string): number | null {
	const match = /^(?:event|screen):(\d+)(?::|$)/.exec(channel);
	return match ? Number(match[1]) : null;
}
