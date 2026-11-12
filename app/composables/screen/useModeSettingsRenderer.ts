import { computed, useTemplateRef } from 'vue';

/** What the generic settings renderer (`ScreenModeSettings`) hands the page. */
export interface ModeSettingsExposed {
	resetConfig: () => void;
	saving: boolean;
}

/**
 * A mode's settings that wrap the generic renderer pass on what it exposes,
 * read through the template ref `renderer` on the `ScreenModeSettings` they
 * mount: `defineExpose(useModeSettingsRenderer())`.
 */
export function useModeSettingsRenderer() {
	const renderer = useTemplateRef<ModeSettingsExposed>('renderer');
	return {
		resetConfig: () => renderer.value?.resetConfig(),
		saving: computed(() => renderer.value?.saving ?? false),
	};
}
