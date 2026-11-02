import type { ComputedRef } from 'vue';
import type { ScreenModeSelectOption } from '~~/shared/screenModeDefinitions';
import { computed } from 'vue';
import { getScreenModeSelectOptions } from '~~/shared/screenModeDefinitions';
import { useEventStore } from '~/stores/event';

/**
 * The Screen Modes a mode picker offers the current Event: those declaring its
 * Card Game. None until the Event is known, so a picker never offers a mode its
 * Event cannot hold.
 */
export function useEventScreenModeSelectOptions(): ComputedRef<ScreenModeSelectOption[]> {
	const eventStore = useEventStore();
	return computed(() => {
		const game = eventStore.event?.game;
		return game
			? getScreenModeSelectOptions(game)
			: [];
	});
}
