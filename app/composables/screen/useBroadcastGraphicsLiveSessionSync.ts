import type { MaybeRefOrGetter } from 'vue';
import { authoringEventChannel } from '~/modules/screen/renderingChannel';

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
 * So losing continuity is itself a reason to reload, exactly as a sequence gap is. This
 * owns that rule for both readers of a Live Session: the Live workspace and every
 * Screen Output. The rule itself, and what a disconnection deliberately does not
 * do, now live in `useReconnectResync`, which every other realtime-fed surface
 * holds to as well (#307); what stays here is the Live Session's own trigger — the
 * Screen or Event this client is following changing under it.
 */
export function useBroadcastGraphicsLiveSessionSync(
	eventId: MaybeRefOrGetter<number | undefined>,
	screenId: MaybeRefOrGetter<number | undefined>,
	/**
	 * The channel this client hears the Live Session's messages on. A live
	 * rendering names its Screen's own; left out, it is the Event's, where the
	 * Live workspace and every other operator surface hear them.
	 */
	channel?: MaybeRefOrGetter<string | null>,
) {
	const sessionStore = useBroadcastGraphicsLiveSessionStore();

	function read(how: 'loadSession' | 'reloadSession') {
		const event = toValue(eventId);
		const screen = toValue(screenId);
		if (!event || !screen)
			return;

		void sessionStore[how](event, screen);
	}

	/**
	 * Read again without the operator asking. What the store is reporting to them,
	 * a refused Take included, stays on show: only opening a Screen reports afresh.
	 */
	function reload() {
		read('reloadSession');
	}

	watch(
		() => [
			toValue(eventId),
			toValue(screenId),
		] as const,
		() => read('loadSession'),
		{ immediate: true },
	);

	const listenedOn = () => {
		if (channel !== undefined)
			return toValue(channel);
		const event = toValue(eventId);
		return event
			? authoringEventChannel(event)
			: null;
	};

	// A rendering's first load is read before its channel attaches. A command
	// applied in between is heard by nothing, and no sequence gap reveals it until
	// the next command, so the first attach reloads too (#733).
	const { disconnected } = useReconnectResync(reload, listenedOn, undefined, { onFirstAttach: reload });

	return { disconnected, reload };
}
