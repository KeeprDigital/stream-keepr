import type { EventReferenceKind } from '~~/shared/screenModes';
import { SCREEN_MODES } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

/**
 * The Screens naming a record in a declared Event Reference of its kind
 * (ADR-0038), in any mode's configuration: those a delete of the record
 * releases (ADR-0060). For a kind whose field holds one id.
 */
export function screensNamingEventReference<T extends { modeConfigs?: unknown }>(
	screens: readonly T[],
	kind: EventReferenceKind,
	id: number,
): T[] {
	return screens.filter((screen) => {
		const configs = (screen.modeConfigs ?? {}) as Record<string, Record<string, unknown> | undefined>;
		return SCREEN_MODE_VALUES.some(mode =>
			Object.entries(SCREEN_MODES[mode].eventReferences)
				.some(([field, declared]) => declared === kind && configs[mode]?.[field] === id));
	});
}
