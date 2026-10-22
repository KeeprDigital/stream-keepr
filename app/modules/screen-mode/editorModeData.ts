import type { Screen } from '~/types';
import { computed, ref, toValue } from 'vue';
import { runInScreenContext } from '~/composables/screen/useScreenContext';

export interface EditedScreen {
	/** The Screen as saved; its renderings read through its saved configuration. */
	screen: () => Screen;
	eventId: () => number;
}

/**
 * A mode's data composable, set up for the Screen a settings editor edits: it
 * reads what the Screen Output reads and keeps it current the same way (Screen
 * Mode Data Freshness), so the editor shows what the Screen renders rather
 * than an estimate from config (#780).
 *
 * It reads the Screen as saved, as its renderings do, and is not interactive:
 * the editor writes the rotation itself (`useRotationConfigWrites`).
 */
export function useEditedScreenModeData<T>(edited: EditedScreen, setup: () => T): T {
	return runInScreenContext({
		screen: computed(() => toValue(edited.screen)),
		eventId: computed(() => toValue(edited.eventId) || null),
		interactive: ref(false),
		overlayContainer: ref(null),
	}, setup);
}
