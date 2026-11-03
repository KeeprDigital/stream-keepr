import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditorLayer } from '~/modules/feature-match-overlay/editorSelection';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { stubPointerCapture } from '~~/test/nuxt/helpers/pointerCapture';
import MultiLayerInspector from '~/components/Screen/Modes/FeatureMatchOverlay/MultiLayerInspector.vue';

/**
 * The property panel with several layers selected (#740): how many, and
 * the geometry they share, written to all of them at once.
 */

const SELECTED: FeatureMatchLayoutEditorLayer[] = [
	{ type: 'source', itemId: 'player1-source' },
	{ type: 'source', itemId: 'player2-source' },
	{ type: 'item', itemId: 'player1-game-wins' },
];

function mountPanel({ writable = true } = {}) {
	const layout: FeatureMatchLayoutConfig = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG).layout;
	return mount(MultiLayerInspector, {
		props: { layout, layers: SELECTED, writable },
		global: { stubs: nuxtUiStubs },
	});
}

function field(wrapper: ReturnType<typeof mountPanel>, axis: string) {
	return wrapper.get<HTMLInputElement>(`[data-testid="multi-layer-${axis}"]`);
}

describe('featureMatchOverlayMultiLayerInspector', () => {
	it('names how many layers are selected', () => {
		expect(mountPanel().get('[data-testid="multi-layer-count"]').text()).toBe('3 layers');
	});

	// The default layout's Player 1 and Player 2 sides share x and width; the Game Wins item differs in all but x and width.
	it.each([
		['x', '24', ''],
		['y', '', 'Mixed'],
		['width', '340', ''],
		['height', '', 'Mixed'],
	])('shows a shared %s, and marks one that differs as mixed', (axis, value, placeholder) => {
		const input = field(mountPanel(), axis);

		expect(input.element.value).toBe(value);
		expect(input.attributes('placeholder') ?? '').toBe(placeholder);
	});

	it('writes an edited field to every selected layer', async () => {
		const wrapper = mountPanel();

		await field(wrapper, 'y').setValue('120');

		expect(wrapper.emitted('update')).toEqual([
			[
				{ y: 120 },
			],
		]);
	});

	it.each([
		{
			case: 'a shared field\'s label writes the dragged value to every layer',
			axis: 'X',
			writable: true,
			updates: [
				[
					{ x: 27 },
				],
			],
		},
		{
			case: 'a Mixed field\'s label writes nothing',
			axis: 'Y',
			writable: true,
			updates: undefined,
		},
		{
			case: 'a label without the lease writes nothing',
			axis: 'X',
			writable: false,
			updates: undefined,
		},
	])('dragging $case', async ({ axis, writable, updates }) => {
		stubPointerCapture();
		const wrapper = mountPanel({ writable });
		const label = wrapper.findAll('[data-number-scrub]').find(handle => handle.text() === axis)!;

		await label.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 0 });
		await label.trigger('pointermove', { pointerId: 1, clientX: 6 });

		expect(wrapper.emitted('update')).toEqual(updates);
	});

	it('writes nothing for an emptied field', async () => {
		const wrapper = mountPanel();

		await field(wrapper, 'width').setValue('');

		expect(wrapper.emitted('update')).toBeUndefined();
	});

	it('edits nothing without the lease', () => {
		expect(mountPanel({ writable: false }).get('fieldset').attributes('disabled')).toBeDefined();
	});
});
