import type { Ref } from 'vue';
import type { PageRotationMode } from '~~/shared/screenModes';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { useArchetypeSpotlightModeData } from '~/composables/screen/useArchetypeSpotlightModeData';
import { useMetagameModeData } from '~/composables/screen/useMetagameModeData';
import { usePairingsModeData } from '~/composables/screen/usePairingsModeData';
import { usePlayerHistoryModeData } from '~/composables/screen/usePlayerHistoryModeData';
import { useStandingsModeData } from '~/composables/screen/useStandingsModeData';
import { useTopCardsModeData } from '~/composables/screen/useTopCardsModeData';

/** What a paginated mode's settings page reads of its mode data: the rows it pages, and whether they are read. */
export interface PagedModeData {
	rowCount: Readonly<Ref<number>>;
	loading: Readonly<Ref<boolean>>;
	answered: Readonly<Ref<boolean>>;
}

/**
 * Each paginated mode's data composable, as its Screen Output reads it, so a
 * settings page counts the pages its Screen renders (#780).
 */
export const PAGED_MODE_DATA: { readonly [M in PageRotationMode]: (context: ScreenContext) => PagedModeData } = {
	'standings': useStandingsModeData,
	'metagame': useMetagameModeData,
	'top-cards': useTopCardsModeData,
	'archetype-spotlight': useArchetypeSpotlightModeData,
	'pairings': usePairingsModeData,
	'player-history': usePlayerHistoryModeData,
};
