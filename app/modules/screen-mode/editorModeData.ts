import type { Screen } from '~/types';
import { computed, ref, shallowRef, toValue, watch } from 'vue';
import { eventCanvasOf } from '~~/shared/eventCanvas';
import { runInScreenContext } from '~/composables/screen/useScreenContext';
import { useEventStore } from '~/stores/event';

export interface EditedScreen {
	/** The Screen as the store shows it, an unsettled edit laid over it. */
	screen: () => Screen;
	eventId: () => number;
	/** An edit of the editor's is not yet answered (`useModeConfigUpdate`'s `saving`). */
	saving: () => boolean;
}

/**
 * A mode's data composable, set up for the Screen a settings editor edits: it
 * reads what the Screen Output reads and keeps it current the same way (Screen
 * Mode Data Freshness), so the editor shows what the Screen renders rather
 * than an estimate from config (#780).
 *
 * It reads through the Screen as saved, as its renderings do. The store shows
 * an edit at once, but the server answers each read from the configuration it
 * holds, so a read sent before the edit is saved would answer the old one and
 * nothing would read again once it lands. So it holds the Screen it reads
 * through while an edit of the editor's is out, and takes the store's once it
 * is answered. It is not interactive: the editor writes the rotation itself
 * (`useRotationConfigWrites`).
 */
export function useEditedScreenModeData<T>(edited: EditedScreen, setup: () => T): T {
	const saved = shallowRef(toValue(edited.screen));
	watch([edited.screen, edited.saving], ([screen, saving]) => {
		if (!saving)
			saved.value = screen;
	});

	// The Event's canvas and Theme too, which a display laying itself out from
	// them reads, so the editor counts the pages its Screen Output counts.
	const eventStore = useEventStore();
	return runInScreenContext({
		screen: saved,
		eventId: computed(() => toValue(edited.eventId) || null),
		interactive: ref(false),
		overlayContainer: ref(null),
		eventCanvas: computed(() => eventCanvasOf(eventStore.event)),
		themeTokens: computed(() => eventStore.eventTheme?.tokens),
	}, setup);
}
