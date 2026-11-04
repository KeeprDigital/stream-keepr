import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import LayerAlignControls from '~/components/Screen/Modes/FeatureMatchOverlay/LayerAlignControls.vue';
import { useFeatureMatchLayoutEditor } from '~/composables/screen/useFeatureMatchLayoutEditor';

/**
 * The property panel's align and distribute buttons (#919): each moves the
 * selected layers through the editor, and none acts without the lease.
 */

const PLAYER1 = { type: 'source', itemId: 'player1-source' } as const;
const PLAYER2 = { type: 'source', itemId: 'player2-source' } as const;
const MAIN = { type: 'source', itemId: 'main-source' } as const;

function mountControls({ writable = true, layers = [PLAYER1] as readonly (typeof PLAYER1 | typeof PLAYER2 | typeof MAIN)[] } = {}) {
	const config = ref<FeatureMatchOverlayModeConfig>(structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG));
	const editor = useFeatureMatchLayoutEditor({
		config,
		updateConfig: (patch) => {
			config.value = {
				...config.value,
				...patch,
			};
		},
		canvasWidth: 1920,
		canvasHeight: 1080,
		writable,
	});
	layers.forEach(layer => editor.toggleSelect(layer));
	const wrapper = mount(LayerAlignControls, {
		props: { editor },
		global: { stubs: nuxtUiStubs },
	});
	const source = (id: string) => config.value.layout.sources.find(item => item.id === id)!;
	return { wrapper, source };
}

function button(wrapper: ReturnType<typeof mountControls>['wrapper'], label: string) {
	return wrapper.get(`button[aria-label="${label}"]`);
}

describe('featureMatchOverlayLayerAlignControls', () => {
	// Player 1's Source is 340×250 at (24, 16): alone, it aligns to the 1920×1080 canvas. Beside
	// it the main Source is 900 high at y 90, and Player 2's starts at 800.
	it.each<[string, Parameters<typeof mountControls>[0], string, number]>([
		[
			'Align bottom',
			{},
			'player1-source',
			830,
		],
		[
			'Distribute vertically',
			{
				layers: [PLAYER1, MAIN, PLAYER2],
			},
			'main-source',
			83,
		],
	])('%s moves the selected layers', async (label, options, id, y) => {
		const { wrapper, source } = mountControls(options);

		await button(wrapper, label).trigger('click');

		expect(source(id).y).toBe(y);
	});

	it.each<[string, Parameters<typeof mountControls>[0], boolean, boolean]>([
		[
			'one layer aligns but has nothing to distribute',
			{},
			true,
			false,
		],
		[
			'three layers align and distribute',
			{
				layers: [PLAYER1, MAIN, PLAYER2],
			},
			true,
			true,
		],
		[
			'nothing acts without the lease',
			{
				writable: false,
				layers: [PLAYER1, MAIN, PLAYER2],
			},
			false,
			false,
		],
	])('%s', (_, options, aligns, distributes) => {
		const { wrapper } = mountControls(options);

		expect(button(wrapper, 'Align left').attributes('disabled')).toBe(aligns ? undefined : '');
		expect(button(wrapper, 'Distribute horizontally').attributes('disabled')).toBe(distributes ? undefined : '');
	});
});
