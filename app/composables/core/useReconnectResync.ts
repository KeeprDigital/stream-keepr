import type { RealtimeTransport } from '~/types/realtime';

/**
 * Reloading authoritative state after this client has been out of touch.
 *
 * Realtime messages are notifications and the server's state is the authority,
 * which has a consequence that only shows up across a disconnection: Ably drops
 * message continuity after a couple of minutes suspended, and every notification
 * published while a client was away is simply gone. Nothing arrives late, so
 * nothing tells the client it fell behind. A Screen Output renders the mode it
 * had when the socket dropped; a Feature Match surface is missing whatever
 * happened in between; a Live Control shows a stack minutes out of date.
 *
 * So reconnection is itself a reason to reload, exactly as a sequence gap is.
 * That principle was written for Broadcast Graphics Live Sessions and honoured by
 * exactly one consumer; this is the same rule with the Live Session taken out of
 * it, so every realtime-fed surface can hold it (#307).
 *
 * ## What it deliberately does not do on a disconnection
 *
 * It does not clear anything, and it exposes `disconnected` rather than acting on
 * it. A disconnected Screen Output must hold its last accepted rendering —
 * program keeps showing what was taken, because a dropped websocket is not an
 * instruction to blank the show, and blanking is the one failure an operator
 * cannot recover from in time. A control surface instead disables its actions and
 * says so, which is a different answer to the same fact.
 */
export function useReconnectResync(
	resync: () => void,
	/**
	 * The transport to watch. Defaulted rather than always resolved, because the
	 * Screen Output's display session is handed its transport rather than looking
	 * one up, and a composable that could only look one up would be unusable there.
	 */
	realtime: Pick<RealtimeTransport, 'connectionState'> | undefined = tryUseRealtime(),
) {
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

	// Only the transition back to connected resyncs. Watching this rather than
	// every connection state keeps a `connecting` → `connected` flap from firing a
	// reload on top of the one the mount already did.
	watch(disconnected, (isDisconnected, wasDisconnected) => {
		if (wasDisconnected && !isDisconnected)
			resync();
	});

	return { disconnected };
}
