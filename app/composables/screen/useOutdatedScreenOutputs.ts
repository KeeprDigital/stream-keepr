import type { MaybeRefOrGetter } from 'vue';
import { SCREEN_CHANNEL_PROTOCOL } from '~/modules/screen/renderingChannel';

/**
 * How many Screen Outputs open on one Screen right now still depend on their
 * Event's channel.
 *
 * An output reports the realtime protocol it follows through Screen presence,
 * as it reports its asset access (#231). One loaded before outputs followed
 * their Screen's own channel reports none, and goes on hearing the Event
 * channel until it is reloaded. Unlike the other self-reports, a silence is
 * counted here: saying nothing is exactly what such an output does.
 */
export function useOutdatedScreenOutputs(
	screenId: MaybeRefOrGetter<number>,
): ComputedRef<number> {
	const screenStore = useScreenStore();

	return computed(() => {
		const members = screenStore.screenPresence.get(toValue(screenId))?.members ?? [];
		return members.filter(member => !((member.data?.protocol ?? 0) >= SCREEN_CHANNEL_PROTOCOL)).length;
	});
}
