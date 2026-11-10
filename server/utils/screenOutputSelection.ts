import type { DbScreen } from '~~/server/db/schema';
import type { ScreenMode } from '~~/shared/types/enums';
import type { ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';

/*
 * What a Screen's saved configuration selects, read without I/O: the Screen
 * Output reads derive their resource from it, and Screen Output publication
 * decides from it which Screens a Feature Match Session's messages may reach.
 */

/** The part of a Screen its selection is read from. */
export type ScreenSelection = Pick<DbScreen, 'currentMode' | 'modeConfigs'>;

/** The saved configuration of one mode, completed with its defaults as an output renders it. */
export function screenOutputModeConfig<M extends ScreenMode>(screen: Pick<DbScreen, 'modeConfigs'>, mode: M): ModeConfigTypeMap[M] {
	return resolveScreenModeConfig(screen.modeConfigs, mode);
}

/** The Feature Match Slot the Screen's current mode shows, if that mode shows one: a Deck List Screen shows a side of one. */
export function screenOutputFeatureMatchSlotId(screen: ScreenSelection): number | null {
	if (screen.currentMode === 'deck') {
		const source = screenOutputModeConfig(screen, 'deck').deckSource;
		return source.type === 'featureMatchSlot'
			? source.slotId
			: null;
	}
	if (screen.currentMode !== 'feature-match' && screen.currentMode !== 'feature-match-overlay')
		return null;
	return screenOutputModeConfig(screen, screen.currentMode).featureMatchId ?? null;
}
