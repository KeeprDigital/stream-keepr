import type { Ref } from 'vue';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { ScreenMode } from '~~/shared/types/enums';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { Screen } from '~/types';
import { computed, ref } from 'vue';
import { SAMPLE_ID, screenModeSampleConfigs } from './sampleDataset';

interface ScreenModeSampleContextOptions {
	mode: ScreenMode;
	/** The Theme previewed, as stored; undefined previews the Default Theme. */
	themeTokens: Ref<StoredThemeTokens | undefined>;
	viewport: Readonly<Ref<{ width: number; height: number }>>;
}

/**
 * A Screen showing `mode` against the Screen Mode Sample Dataset, as a Theme
 * preview provides it to the Screen host.
 *
 * It is a preview of no Event: there is no Event channel to follow, and every
 * read answers from the dataset. It is a preview too, so a graphics host with
 * no Feature Match Slot shows the Feature Match Sample Dataset. Nothing else
 * builds a context with `sampleDataset`, so no Screen Output can.
 */
export function createScreenModeSampleContext(options: ScreenModeSampleContextOptions): ScreenContext {
	const screen: Screen = {
		id: SAMPLE_ID,
		eventId: SAMPLE_ID,
		name: 'Sample',
		slug: 'sample',
		currentMode: options.mode,
		modeConfigs: screenModeSampleConfigs(options.mode),
		screenConfig: { width: 1920, height: 1080 },
		stateVersion: 0,
		createdAt: new Date(0),
		updatedAt: new Date(0),
	};
	return {
		screen: ref(screen),
		eventId: computed(() => null),
		interactive: ref(false),
		overlayContainer: ref(null),
		isPreview: ref(true),
		outputMode: ref('overlay'),
		themeTokens: options.themeTokens,
		sampleDataset: true,
		viewport: options.viewport,
	};
}
