import type { ComputedRef } from 'vue';
import type { ScreenModeSelectOption } from '~~/shared/screenModeDefinitions';
import { computed } from 'vue';
import { getScreenModeSelectOptions } from '~~/shared/screenModeDefinitions';

/** The Screen Modes a mode picker offers the current Event: those declaring its Card Game. */
export function useEventScreenModeSelectOptions(): ComputedRef<ScreenModeSelectOption[]> {
	const eventStore = useEventStore();
	return computed(() => getScreenModeSelectOptions(eventStore.event?.game));
}
