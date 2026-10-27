import type { ScreenConfig, ScreenConfigPatch } from '~~/shared/types/screenConfig';
import { DEFAULT_SCREEN_CONFIG } from '~~/shared/types/screenConfig';

interface UseScreenConfigUpdateOptions {
	/** Debounce delay in ms before flushing to API. Default: 300 */
	debounceMs?: number;
}

/**
 * Composable for screen-level config updates with local-first UI.
 *
 * Thin wrapper around `useConfigUpdate` with screen-config-specific getter/setter.
 *
 * Usage:
 * ```ts
 * const { screenConfig, saving, updateScreenConfig, resetScreenConfig } = useScreenConfigUpdate(
 *   () => props.eventId, () => props.screen.id,
 * );
 * ```
 */
export function useScreenConfigUpdate(
	eventId: MaybeRefOrGetter<number>,
	screenId: MaybeRefOrGetter<number>,
	options: UseScreenConfigUpdateOptions = {},
) {
	const { debounceMs = 300 } = options;

	const screenStore = useScreenStore();

	const { config, saving, saveError, updateConfig, retry } = useConfigUpdate<ScreenConfig, ScreenConfigPatch>({
		getStoreConfig: () => {
			const screen = screenStore.screens.find(s => s.id === toValue(screenId));
			return (screen?.screenConfig ?? {}) as Partial<ScreenConfig>;
		},
		saveToStore: updates =>
			screenStore.updateScreenConfig(toValue(eventId), toValue(screenId), updates),
		defaults: DEFAULT_SCREEN_CONFIG,
		debounceMs,
		errorMessage: 'Failed to update screen config',
	});

	/** Reset layout-related screen config while preserving theme colors and color mode. */
	function resetScreenConfig() {
		updateConfig({
			paddingX: null,
			paddingY: null,
			horizontalAlign: null,
			verticalAlign: null,
		});
	}

	return {
		screenConfig: config,
		saving,
		saveError,
		updateScreenConfig: updateConfig,
		resetScreenConfig,
		retry,
	};
}
