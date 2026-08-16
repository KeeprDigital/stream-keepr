import type { ScreenMode } from '~~/shared/types/enums';
import type { ModeConfigsMap, ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import { getDefaultConfigForMode, getDisplayDefaultsForMode } from '~~/shared/types/screenConfig';

interface UseModeConfigUpdateOptions<M extends ScreenMode> {
	/** Debounce delay in ms before flushing to API. Default: 300 */
	debounceMs?: number;
	/** Default config values for this mode. Defaults to the shared mode defaults. */
	defaults?: ModeConfigTypeMap[M];
}

/**
 * Composable for screen mode config updates with local-first UI.
 *
 * Thin wrapper around `useConfigUpdate` with mode-config-specific getter/setter.
 *
 * Usage:
 * ```ts
 * const { config, updateConfig, saving } = useModeConfigUpdate(
 *   () => props.eventId, () => props.screen.id, 'feature-match',
 * );
 * ```
 */
export function useModeConfigUpdate<M extends ScreenMode>(
	eventId: MaybeRefOrGetter<number>,
	screenId: MaybeRefOrGetter<number>,
	mode: M,
	options: UseModeConfigUpdateOptions<M> = {},
) {
	type ConfigType = ModeConfigTypeMap[M];
	const { debounceMs = 300, defaults = getDefaultConfigForMode(mode) } = options;

	const screenStore = useScreenStore();

	const { config, saving, saveState, saveError, updateConfig, retry } = useConfigUpdate<ConfigType>({
		getStoreConfig: () => {
			const screen = screenStore.screens.find(s => s.id === toValue(screenId));
			const modeConfigs = (screen?.modeConfigs ?? {}) as ModeConfigsMap;
			return (modeConfigs[mode] ?? {}) as Partial<ConfigType>;
		},
		saveToStore: updates =>
			screenStore.updateModeConfig(toValue(eventId), toValue(screenId), mode, updates),
		defaults,
		debounceMs,
		errorMessage: 'Failed to update screen config',
	});

	/** Reset all display settings to defaults (preserves data bindings like matchId/playerId). */
	function resetConfig() {
		const displayDefaults = getDisplayDefaultsForMode(mode);
		updateConfig(displayDefaults as Partial<ConfigType>);
	}

	return { config, saving, saveState, saveError, updateConfig, resetConfig, retry };
}
