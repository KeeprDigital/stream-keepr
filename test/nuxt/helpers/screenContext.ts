import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { computed, ref } from 'vue';

/**
 * The Screen context a mode's data is set up against: no Screen, no Event, not
 * interactive, with whatever the test sets. A fake Screen or Event id needs no
 * cast, so each field takes any value.
 */
export function screenContextOf(fields: { [K in keyof ScreenContext]?: unknown } = {}): ScreenContext {
	return {
		screen: ref(null),
		eventId: computed(() => null),
		interactive: ref(false),
		overlayContainer: ref(null),
		...fields,
	} as ScreenContext;
}
