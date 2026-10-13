import type { FeatureMatchOverlayModeConfig, FeatureMatchSourceItemConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayAnchorValue } from '~/utils/featureMatchOverlayGeometry';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { NINE_POINT_VALUES } from '~~/shared/utils/ninePoints';

/**
 * A Source Item's Bounds section, with the real geometry fields and editor: what
 * each align action leaves in the layout.
 */

const PassThroughStub = defineComponent({
	template: '<div><slot /></div>',
});

const UButtonStub = defineComponent({
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\', $event)"><slot /></button>',
});

async function mountBounds(anchor: FeatureMatchOverlayAnchorValue) {
	const { default: InspectorSource } = await import('~/components/Screen/Modes/FeatureMatchOverlay/InspectorSource.vue');
	const config: FeatureMatchOverlayModeConfig = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	// An odd-sized 401×201 item at (100, 50) on a 1920×1080 canvas, so a
	// centre anchor sits on a half pixel.
	const item: FeatureMatchSourceItemConfig = { ...config.layout.sources[0]!, x: 100, y: 50, width: 401, height: 201, anchor };
	config.layout.sources = [item];
	const updateConfig = vi.fn();

	const wrapper = mount(InspectorSource, {
		props: { config, updateConfig, screenWidth: 1920, screenHeight: 1080, item },
		global: {
			stubs: {
				FeatureMatchOverlayControlSection: PassThroughStub,
				FeatureMatchOverlaySourceFramingStyleFields: true,
				FeatureMatchOverlayOrderSection: true,
				ScreenSettingsToggle: true,
				UFormField: PassThroughStub,
				UFieldGroup: PassThroughStub,
				UINinePointPicker: true,
				UInput: true,
				UInputNumber: true,
				USelect: true,
				UButton: UButtonStub,
			},
		},
	});

	async function align(label: string) {
		await wrapper.get(`button[aria-label="${label}"]`).trigger('click');
		const layout = updateConfig.mock.calls.at(-1)?.[0].layout as FeatureMatchOverlayModeConfig['layout'];
		const { x, y, width, height } = layout.sources[0]!;
		return { x, y, width, height };
	}

	return { align };
}

describe('feature Match Overlay Source Item bounds: align actions', () => {
	const actions = [
		['Hard left', { x: 0, y: 50 }],
		['Center horizontally', { x: 759.5, y: 50 }],
		['Hard right', { x: 1519, y: 50 }],
		['Hard top', { x: 100, y: 0 }],
		['Center vertically', { x: 100, y: 439.5 }],
		['Hard bottom', { x: 100, y: 879 }],
	] as const;
	const cases = NINE_POINT_VALUES.flatMap(anchor => actions.map(([label, position]) => [anchor, label, position] as const));

	it.each(cases)('%s anchor: %s moves the item\'s edge, not its anchor', async (anchor, label, position) => {
		const { align } = await mountBounds(anchor);

		expect(await align(label)).toEqual({ ...position, width: 401, height: 201 });
	});
});
