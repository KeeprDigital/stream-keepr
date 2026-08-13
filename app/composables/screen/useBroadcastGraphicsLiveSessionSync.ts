import type { MaybeRefOrGetter } from 'vue';

/**
 * Keeping one client's view of a Broadcast Graphics Live Session honest across a
 * disconnection.
 *
 * Realtime messages are notifications and the snapshot is the authority, which has
 * a consequence that only shows up when the connection drops: every notification
 * published while a client was away is simply gone. Nothing arrives late, so
 * nothing tells the client it fell behind — a Live Control would show a stack that
 * is minutes out of date and an operator would take the wrong graphic off air.
 *
 * So reconnection is itself a reason to reload, exactly as a sequence gap is. This
 * owns that rule for both readers of a Live Session: the Live workspace and every
 * Screen Output. The rule itself, and what a disconnection deliberately does not
 * do, now live in `useReconnectResync`, which every other realtime-fed surface
 * holds to as well (#307); what stays here is the Live Session's own trigger — the
 * Screen or Event this client is following changing under it.
 */
export function useBroadcastGraphicsLiveSessionSync(
	eventId: MaybeRefOrGetter<number | undefined>,
	screenId: MaybeRefOrGetter<number | undefined>,
) {
	const sessionStore = useBroadcastGraphicsLiveSessionStore();

	function reload() {
		const event = toValue(eventId);
		const screen = toValue(screenId);
		if (!event || !screen)
			return;

		void sessionStore.loadSession(event, screen);
	}

	watch(
		() => [toValue(eventId), toValue(screenId)] as const,
		() => reload(),
		{ immediate: true },
	);

	const { disconnected } = useReconnectResync(reload);

	return { disconnected, reload };
}
