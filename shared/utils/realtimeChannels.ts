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
 * The Event a realtime channel belongs to, or null for unrecognized shapes.
 * Every channel built above encodes its Event; the transport uses this to
 * scope its token without callers passing the Event separately.
 */
export function realtimeChannelEventId(channel: string): number | null {
	const match = /^(?:event|screen):(\d+)(?::|$)/.exec(channel);
	return match ? Number(match[1]) : null;
}
