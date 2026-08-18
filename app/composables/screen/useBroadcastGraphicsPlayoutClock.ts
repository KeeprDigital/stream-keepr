import type { MaybeRefOrGetter, Ref } from 'vue';
import type { BroadcastGraphicConfig, GraphicChannelConfig } from '~~/shared/types/graphics';

/**
 * The one authoritative instant a Broadcast Graphics surface projects playout at.
 *
 * What is on program, which values are showing, and whether any of them are media
 * are all answers to the same question — "at *when*?" — and reading two of them at
 * two instants is how a surface disagrees with the output it is watching. Every
 * projection a component makes must read this one instant.
 *
 * Each caller holds its own clock; what is shared is the authority it advances
 * from — the session store's serverNow — and the rule for when it runs.
 *
 * The clock advances while anything is in flight and stops when everything is
 * settled, because a settled phase cannot change and an operator's browser has
 * better things to do sixty times a second. It restarts whenever the Broadcast
 * Graphics Live Session moves on.
 */
export function useBroadcastGraphicsPlayoutClock(
	screenId: MaybeRefOrGetter<number>,
	graphics: MaybeRefOrGetter<readonly BroadcastGraphicConfig[]>,
	channels?: MaybeRefOrGetter<readonly GraphicChannelConfig[] | undefined>,
): Readonly<Ref<number>> {
	const sessionStore = useBroadcastGraphicsLiveSessionStore();
	const now = ref(sessionStore.serverNow());

	let frame: number | null = null;

	function stopClock() {
		if (frame !== null && import.meta.client)
			cancelAnimationFrame(frame);
		frame = null;
	}

	function advance() {
		now.value = sessionStore.serverNow();
		const projection = sessionStore.animationProjection(
			toValue(screenId),
			toValue(graphics),
			now.value,
			toValue(channels),
		);
		if (
			Object.keys(projection).length === 0
			&& !sessionStore.hasActiveSocialProfileRotation(toValue(screenId), toValue(graphics))
		) {
			stopClock();
			return;
		}
		frame = requestAnimationFrame(advance);
	}

	watch(
		() => {
			const session = sessionStore.sessions.get(toValue(screenId));
			return session ? `${session.id}:${session.sequence}` : null;
		},
		() => {
			if (!import.meta.client)
				return;
			now.value = sessionStore.serverNow();
			if (frame === null)
				frame = requestAnimationFrame(advance);
		},
		{ immediate: true },
	);

	onBeforeUnmount(stopClock);

	return readonly(now);
}
