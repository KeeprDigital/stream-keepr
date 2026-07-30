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
 * Screen Output.
 *
 * ## What it deliberately does not do on a disconnection
 *
 * It does not clear anything. A disconnected Screen Output must hold its last
 * accepted rendering — program keeps showing what was taken, because a dropped
 * websocket is not an instruction to blank the show, and blanking is the one
 * failure an operator cannot recover from in time. Live Control instead disables
 * its actions and says so, which is why `disconnected` is exposed rather than
 * acted on here.
 */
export function useBroadcastGraphicsLiveSessionSync(
	eventId: MaybeRefOrGetter<number | undefined>,
	screenId: MaybeRefOrGetter<number | undefined>,
) {
	const sessionStore = useBroadcastGraphicsLiveSessionStore();
	const realtime = tryUseRealtime();

	/**
	 * Whether this client is currently out of touch with the authoritative order.
	 *
	 * `initialized` and `connecting` are deliberately not disconnections: the first
	 * moments of a page load are not a lost connection, and reporting one would make
	 * every reload flash a fault at the operator.
	 */
	const disconnected = computed(() => {
		if (!realtime)
			return false;
		return realtime.connectionState === 'disconnected'
			|| realtime.connectionState === 'suspended'
			|| realtime.connectionState === 'failed'
			|| realtime.connectionState === 'closed';
	});

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

	// Only the transition back to connected reloads. Watching `isConnected` rather
	// than every connection state keeps a `connecting` → `connected` flap from
	// firing a second reload on top of the one the mount already did.
	watch(disconnected, (isDisconnected, wasDisconnected) => {
		if (wasDisconnected && !isDisconnected)
			reload();
	});

	return { disconnected, reload };
}
