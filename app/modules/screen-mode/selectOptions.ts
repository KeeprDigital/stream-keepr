import type { ComputedRef } from 'vue';
import type { ScreenModeSelectOption } from '~~/shared/screenModeDefinitions';
import { computed } from 'vue';
import { getScreenModeSelectOptions } from '~~/shared/screenModeDefinitions';

/** The Screen Modes a mode picker offers the current Event: those declaring its kind. */
export function useEventScreenModeSelectOptions(): ComputedRef<ScreenModeSelectOption[]> {
	const kind = useEventKind();
	return computed(() => getScreenModeSelectOptions(kind.value));
}
