import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditorLayer } from '~/modules/feature-match-overlay/editorSelection';
import type { LayerGroupRefusal } from '~/modules/feature-match-overlay/layerGrouping';
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

function mountPanel({
	writable = true,
	groupRefusal = null as LayerGroupRefusal | null,
	layers = SELECTED,
	canAlign = true,
	canDistribute = true,
} = {}) {
	const layout: FeatureMatchLayoutConfig = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG).layout;
	return mount(MultiLayerInspector, {
		props: {
			layout,
			layers,
			writable,
			groupRefusal,
			canAlign,
			canDistribute,
		},
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

	// E8: a selection ⌘G cannot group says why beside the disabled control (#920).
	it.each([
		[
			'groups a selection it can',
			{ groupRefusal: null },
			false,
			'',
			[[]],
		],
		[
			'says why a Source Item keeps it from grouping',
			{ groupRefusal: 'source-item' as const },
			true,
			'Source Items can\'t be grouped',
			undefined,
		],
		[
			'groups nothing without the lease',
			{ writable: false, groupRefusal: null },
			true,
			'',
			undefined,
		],
	])('%s', async (_case, options, disabled, reason, emitted) => {
		const wrapper = mountPanel(options);
		const button = wrapper.get('[data-testid="multi-layer-group"]');
		const refusal = wrapper.find('[data-testid="multi-layer-group-refusal"]');

		await button.trigger('click');

		expect(button.attributes('disabled') !== undefined).toBe(disabled);
		expect(refusal.exists()
			? refusal.text()
			: '').toBe(reason);
		expect(wrapper.emitted('group')).toEqual(emitted);
	});

	// Each action once (#1069): the geometry section is the one place that aligns and distributes.
	it.each([
		['Align top', 'align', 'top'],
		['Align centre', 'align', 'center'],
		['Distribute vertically', 'distribute', 'y'],
	])('%s asks for the selection to move', async (label, event, argument) => {
		const wrapper = mountPanel();

		await wrapper.get(`button[aria-label="${label}"]`).trigger('click');

		expect(wrapper.emitted(event)).toEqual([[argument]]);
	});

	// Distributing needs three, so two selected layers are offered alignment alone.
	it.each([
		[2, 6, 0],
		[3, 6, 2],
	])('offers %i selected layers %i align and %i distribute controls', (count, aligns, distributes) => {
		const wrapper = mountPanel({ layers: SELECTED.slice(0, count) });

		expect(wrapper.findAll('button[aria-label^="Align "]')).toHaveLength(aligns);
		expect(wrapper.findAll('button[aria-label^="Distribute "]')).toHaveLength(distributes);
	});

	it.each([
		['layers that do not align', { canAlign: false, canDistribute: false }],
		['a session without the lease', { writable: false }],
	])('aligns and distributes nothing for %s', async (_case, options) => {
		const wrapper = mountPanel(options);

		for (const button of wrapper.findAll('button[aria-label^="Align "], button[aria-label^="Distribute "]')) {
			expect(button.attributes('disabled')).toBeDefined();
			await button.trigger('click');
		}

		expect(wrapper.emitted('align')).toBeUndefined();
		expect(wrapper.emitted('distribute')).toBeUndefined();
	});
});
