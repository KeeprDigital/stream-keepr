import type { BroadcastGraphicConfig, ShapeGraphicItemConfig } from '~~/shared/types/graphics';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { onAirBroadcastGraphicIds } from '~~/shared/modules/broadcast-graphics-live-session';
import { squareShapeGeometry } from '~~/shared/modules/graphics';
import { GRAPHICS_PREVIEW_STATE_MESSAGE } from '~/modules/graphics/previewMessages';

enableAutoUnmount(afterEach);

const mockOutputMode = ref<ScreenOutput>('overlay');
const mockOutputModeProvided = ref(true);
const mockIsPreview = ref(false);
const mockPreviewGuides = ref(false);
const mockPreviewSafeAreas = ref(false);
const mockScreen = ref<Screen | null>(null);

mockNuxtImport('useScreenContext', () => () => ({
	screen: mockScreen,
	eventId: computed(() => 1),
	interactive: ref(false),
	overlayContainer: ref(null),
	outputMode: mockOutputModeProvided.value ? mockOutputMode : undefined,
	isPreview: mockIsPreview,
	previewGuides: mockPreviewGuides,
	previewSafeAreas: mockPreviewSafeAreas,
}));

mockNuxtImport('useScreenModeConfig', () => () => computed(() => ({
	graphics: [],
	...mockScreen.value?.modeConfigs?.['broadcast-graphics'],
})));

const bar: ShapeGraphicItemConfig = {
	type: 'shape',
	id: 'bar',
	label: 'Shape 1',
	visible: true,
	anchor: 'top-left',
	x: 100,
	y: 800,
	width: 900,
	height: 120,
	geometry: squareShapeGeometry(),
	surfaceStyle: { fill: { type: 'solid', color: '#0077a3' }, fillOpacity: 1 },
};

/** The authoritative playout snapshot a live Screen Output would have loaded. */
const mockOnAirGraphicIds = ref<string[]>([]);
const mockLoadSession = ref<(eventId: number, screenId: number) => void>(() => {});

mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({
	// Delegates to the real reducer rather than reimplementing the authored-order
	// filter, so this test cannot pass on a filter the Screen Output does not use.
	onAirGraphicIds: (_screenId: number, graphics: readonly { id: string }[]) =>
		onAirBroadcastGraphicIds(
			{ playout: Object.fromEntries(mockOnAirGraphicIds.value.map(id => [id, { onAir: true, effectiveStartedAt: 0, cut: false }])) },
			graphics,
		),
	loadSession: (eventId: number, screenId: number) => mockLoadSession.value(eventId, screenId),
}));

const lowerThird: BroadcastGraphicConfig = {
	id: 'lower-third',
	name: 'Lower Third',
	items: [bar],
};

function screenWithStack(graphics: BroadcastGraphicConfig[] = []): Screen {
	return {
		id: 1,
		slug: 'main',
		screenConfig: { width: 1920, height: 1080 },
		modeConfigs: graphics.length ? { 'broadcast-graphics': { graphics } } : {},
	} as Screen;
}

async function mountComponent() {
	const componentPath = '../../../../../../../app/components/Screen/Modes/BroadcastGraphics/Display.vue';
	const { default: Display } = await import(componentPath);

	return mount(Display);
}

function pushPreviewState(graphics: BroadcastGraphicConfig[] = [lowerThird], animation?: unknown) {
	window.dispatchEvent(new MessageEvent('message', {
		origin: window.location.origin,
		source: window,
		data: {
			type: GRAPHICS_PREVIEW_STATE_MESSAGE,
			state: {
				graphics,
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
				animation,
			},
		},
	}));
	return nextTick();
}

/** A Broadcast Graphic whose bar fades and slides in over four seconds. */
const animatedLowerThird: BroadcastGraphicConfig = {
	...lowerThird,
	items: [{
		...bar,
		animation: {
			enter: {
				duration: 4000,
				easing: 'linear',
				delay: 0,
				fade: { opacity: 0 },
				slide: { direction: 'south', distanceMode: 'fixed', distance: 120 },
			},
		},
	}],
};

function previewPlan(overrides: Record<string, unknown> = {}) {
	return {
		graphicId: 'lower-third',
		scope: 'phase',
		phase: 'enter',
		run: 1,
		speed: 1,
		loop: false,
		...overrides,
	};
}

function itemStyle(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return wrapper.get('[data-graphic-item-kind="shape"]').attributes('style') ?? '';
}

describe('broadcastGraphicsDisplay', () => {
	beforeEach(() => {
		mockOutputMode.value = 'overlay';
		mockOutputModeProvided.value = true;
		mockIsPreview.value = false;
		mockPreviewGuides.value = false;
		mockPreviewSafeAreas.value = false;
		mockScreen.value = screenWithStack();
		mockOnAirGraphicIds.value = [];
		mockLoadSession.value = () => {};
	});

	it('renders an empty Broadcast Graphics Screen transparent in the Overlay Output', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.classes()).toContain('broadcast-graphics--overlay');
		expect(wrapper.attributes('style')).toContain('background: transparent');
	});

	it('renders an empty Broadcast Graphics Screen black in the Fill Output', async () => {
		mockOutputMode.value = 'fill';

		const wrapper = await mountComponent();

		expect(wrapper.classes()).toContain('broadcast-graphics--fill');
		expect(wrapper.attributes('style')).toContain('background: #000');
	});

	it('renders an empty Broadcast Graphics Screen black in the Key Output', async () => {
		mockOutputMode.value = 'key';

		const wrapper = await mountComponent();

		expect(wrapper.classes()).toContain('broadcast-graphics--key');
		expect(wrapper.attributes('style')).toContain('background: #000');
	});

	it('falls back to the Overlay Output when the Screen context supplies no output selection', async () => {
		mockOutputModeProvided.value = false;

		const wrapper = await mountComponent();

		expect(wrapper.classes()).toContain('broadcast-graphics--overlay');
		expect(wrapper.attributes('style')).toContain('background: transparent');
	});

	it('leaves an authored but off-air Broadcast Graphic off every Screen Output', async () => {
		mockScreen.value = screenWithStack([lowerThird]);

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-broadcast-graphic="lower-third"]').exists()).toBe(false);
	});

	it('composes a Broadcast Graphic that playout has taken on air', async () => {
		mockScreen.value = screenWithStack([lowerThird]);
		mockOnAirGraphicIds.value = ['lower-third'];

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-broadcast-graphic="lower-third"]').exists()).toBe(true);
		expect(wrapper.get('[data-graphic-item-kind="shape"]').attributes('style')).toContain('left: 100px');
	});

	it('composes concurrent on-air Broadcast Graphics in authored stack order, not take order', async () => {
		const bug: BroadcastGraphicConfig = { ...lowerThird, id: 'bug', name: 'Bug' };
		mockScreen.value = screenWithStack([bug, lowerThird]);
		mockOnAirGraphicIds.value = ['lower-third', 'bug'];

		const wrapper = await mountComponent();

		const composed = wrapper.findAll('[data-broadcast-graphic]')
			.map(node => node.attributes('data-broadcast-graphic'));

		expect(composed).toEqual(['bug', 'lower-third']);
	});

	it('loads the authoritative playout snapshot for a live Screen Output', async () => {
		const loads: Array<[number, number]> = [];
		mockLoadSession.value = (eventId, screenId) => {
			loads.push([eventId, screenId]);
		};
		mockScreen.value = screenWithStack([lowerThird]);

		await mountComponent();

		expect(loads).toEqual([[1, 1]]);
	});

	it('never loads a playout snapshot for an embedded editor preview', async () => {
		const loads: Array<[number, number]> = [];
		mockLoadSession.value = (eventId, screenId) => {
			loads.push([eventId, screenId]);
		};
		mockIsPreview.value = true;
		mockScreen.value = screenWithStack([lowerThird]);

		await mountComponent();

		expect(loads).toEqual([]);
	});

	it('never draws advisory guides on a live Screen Output', async () => {
		mockScreen.value = screenWithStack([lowerThird]);

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-safe-area-guide]').exists()).toBe(false);
		expect(wrapper.find('.item-guide').exists()).toBe(false);
	});

	it('composes the Broadcast Graphic under authoring inside an editor preview', async () => {
		mockIsPreview.value = true;

		const wrapper = await mountComponent();
		await pushPreviewState();

		expect(wrapper.find('[data-broadcast-graphic="lower-third"]').exists()).toBe(true);
		expect(wrapper.get('[data-graphic-item-kind="shape"]').attributes('style')).toContain('left: 100px');
	});

	it('ignores a working composition pushed at a live Screen Output', async () => {
		const wrapper = await mountComponent();
		await pushPreviewState();

		expect(wrapper.find('[data-broadcast-graphic="lower-third"]').exists()).toBe(false);
	});

	it('composes every authored Broadcast Graphic in an editor preview, in stack order', async () => {
		mockIsPreview.value = true;
		const behind: BroadcastGraphicConfig = { ...lowerThird, id: 'bug', name: 'Bug' };

		const wrapper = await mountComponent();
		await pushPreviewState([behind, lowerThird]);

		const composed = wrapper.findAll('[data-broadcast-graphic]')
			.map(node => node.attributes('data-broadcast-graphic'));

		expect(composed).toEqual(['bug', 'lower-third']);
	});

	it('reorders the composed preview when the authored stack order changes', async () => {
		mockIsPreview.value = true;
		const behind: BroadcastGraphicConfig = { ...lowerThird, id: 'bug', name: 'Bug' };

		const wrapper = await mountComponent();
		await pushPreviewState([behind, lowerThird]);
		await pushPreviewState([lowerThird, behind]);

		const composed = wrapper.findAll('[data-broadcast-graphic]')
			.map(node => node.attributes('data-broadcast-graphic'));

		expect(composed).toEqual(['lower-third', 'bug']);
	});

	it('marks the Broadcast Graphic under authoring among its neighbours', async () => {
		mockIsPreview.value = true;
		mockPreviewGuides.value = true;
		const behind: BroadcastGraphicConfig = { ...lowerThird, id: 'bug', name: 'Bug' };

		const wrapper = await mountComponent();
		await pushPreviewState([behind, lowerThird]);

		const marks = wrapper.findAll('.item-guide')
			.map(node => node.attributes('data-in-selected-graphic'));

		expect(marks).toEqual(['false', 'true']);
	});

	it('draws advisory action-safe and title-safe guides only when the preview asks for them', async () => {
		mockIsPreview.value = true;
		mockPreviewSafeAreas.value = true;

		const wrapper = await mountComponent();
		await pushPreviewState();

		expect(wrapper.get('[data-safe-area-guide="action-safe"]').attributes('style')).toContain('left: 96px');
		expect(wrapper.get('[data-safe-area-guide="title-safe"]').attributes('style')).toContain('left: 192px');
	});

	it('marks the selected Graphic Item when the preview asks for item guides', async () => {
		mockIsPreview.value = true;
		mockPreviewGuides.value = true;

		const wrapper = await mountComponent();
		await pushPreviewState();

		expect(wrapper.get('.item-guide').classes()).toContain('is-selected');
	});

	it('paints a Graphic Surface Style as one Shape Geometry path with its outline', async () => {
		mockIsPreview.value = true;
		const outlined: BroadcastGraphicConfig = {
			...lowerThird,
			items: [{
				...bar,
				geometry: { ...squareShapeGeometry(), rightSlant: 60 },
				surfaceStyle: {
					fill: { type: 'solid', color: '#0077a3' },
					fillOpacity: 1,
					outline: { color: '#00d9ff', width: 3 },
				},
			}],
		};

		const wrapper = await mountComponent();
		await pushPreviewState([outlined]);

		const paths = wrapper.findAll('[data-graphic-item-kind="shape"] path');
		// One fill, one clip path for the stroke, and the stroke itself.
		expect(paths.length).toBe(3);
		expect(paths[0]!.attributes('d')).toBe('M 0 0 L 840 0 L 900 120 L 0 120 Z');
		// The surface stretches to the box the layout actually gave the item, so the
		// case-sensitive SVG attribute has to survive the template.
		expect(wrapper.get('[data-graphic-item-kind="shape"] svg').attributes('preserveAspectRatio')).toBe('none');
		expect(wrapper.get('[data-graphic-item-kind="shape"] path[stroke]').attributes('stroke-width')).toBe('6');
	});

	it('composes a Graphic Group and its children in one stacking context', async () => {
		mockIsPreview.value = true;
		const grouped: BroadcastGraphicConfig = {
			id: 'lower-third',
			name: 'Lower Third',
			items: [{
				type: 'group',
				id: 'cluster',
				label: 'Name block',
				visible: true,
				anchor: 'top-left',
				x: 100,
				y: 800,
				width: 900,
				height: 120,
				arrangement: 'row',
				padding: 12,
				gap: 8,
				align: 'stretch',
				justify: 'start',
				clip: true,
				geometry: squareShapeGeometry(),
				children: [{
					...bar,
					id: 'child',
					x: 0,
					y: 0,
					sizing: { mode: 'fill', size: 0, weight: 1 },
				}],
			}],
		};

		const wrapper = await mountComponent();
		await pushPreviewState([grouped]);

		const group = wrapper.get('[data-graphic-item-kind="group"]');
		expect(group.attributes('style')).toContain('display: flex');
		expect(group.attributes('style')).toContain('padding: 12px');
		expect(group.find('[data-graphic-item-kind="shape"]').exists()).toBe(true);
		// The browser expands the flex shorthand, so a weighted-fill child grows.
		expect(group.get('[data-graphic-item-kind="shape"]').attributes('style')).toContain('flex-grow: 1');
		expect(group.get('[data-graphic-item-kind="shape"]').attributes('style')).toContain('flex-basis: 0px');
	});
});

describe('graphicAnimationPreview in a Screen Output frame', () => {
	beforeEach(() => {
		mockOutputMode.value = 'overlay';
		mockOutputModeProvided.value = true;
		mockIsPreview.value = true;
		mockPreviewGuides.value = false;
		mockPreviewSafeAreas.value = false;
		mockScreen.value = screenWithStack();
		mockOnAirGraphicIds.value = [];
		mockLoadSession.value = () => {};
	});

	it('composes at the Graphic Resting State with no preview run', async () => {
		const wrapper = await mountComponent();
		await pushPreviewState([animatedLowerThird]);

		// An author laying a composition out sees the authored result, not frame zero
		// of an entrance.
		expect(itemStyle(wrapper)).not.toContain('opacity');
		expect(itemStyle(wrapper)).not.toContain('transform');
	});

	it('starts a run at the beginning of the phase it was asked for', async () => {
		const wrapper = await mountComponent();
		await pushPreviewState([animatedLowerThird], previewPlan());

		// The enter phase begins fully faded out and a full slide away from rest.
		expect(itemStyle(wrapper)).toContain('opacity: 0');
		expect(itemStyle(wrapper)).toContain('translate(0px, 120px)');
	});

	it('settles back at the Graphic Resting State when the run is stopped', async () => {
		const wrapper = await mountComponent();
		await pushPreviewState([animatedLowerThird], previewPlan());
		await pushPreviewState([animatedLowerThird], null);

		expect(itemStyle(wrapper)).not.toContain('opacity');
		expect(itemStyle(wrapper)).not.toContain('transform');
	});

	it('runs an exit phase from the Graphic Resting State outwards', async () => {
		const exiting: BroadcastGraphicConfig = {
			...lowerThird,
			items: [{
				...bar,
				animation: {
					exit: { duration: 4000, easing: 'linear', delay: 0, reveal: { edge: 'right' } },
				},
			}],
		};

		const wrapper = await mountComponent();
		await pushPreviewState([exiting], previewPlan({ phase: 'exit' }));

		// A wipe at the start of an exit is still fully open.
		expect(itemStyle(wrapper)).not.toContain('mask-image');
	});

	it('leaves every other Broadcast Graphic at its Graphic Resting State', async () => {
		const other: BroadcastGraphicConfig = { ...animatedLowerThird, id: 'bug', name: 'Bug' };

		const wrapper = await mountComponent();
		await pushPreviewState([other, animatedLowerThird], previewPlan());

		const styles = wrapper.findAll('[data-graphic-item-kind="shape"]')
			.map(node => node.attributes('style') ?? '');

		expect(styles[0]).not.toContain('opacity: 0');
		expect(styles[1]).toContain('opacity: 0');
	});

	it('ignores a malformed preview run rather than animating unpredictably', async () => {
		const wrapper = await mountComponent();
		await pushPreviewState([animatedLowerThird], previewPlan({ speed: -3 }));

		expect(itemStyle(wrapper)).not.toContain('opacity: 0');
	});

	it('ignores a preview run naming a Broadcast Graphic that is not in the composition', async () => {
		const wrapper = await mountComponent();
		await pushPreviewState([animatedLowerThird], previewPlan({ graphicId: 'deleted' }));

		expect(itemStyle(wrapper)).not.toContain('opacity: 0');
	});

	it('never animates a live Screen Output from a pushed preview run', async () => {
		// Preview gating, on the output side: a live Screen Output ignores the whole
		// state message, so a preview run cannot reach program by being posted at it.
		mockIsPreview.value = false;
		mockScreen.value = screenWithStack([animatedLowerThird]);
		mockOnAirGraphicIds.value = ['lower-third'];

		const wrapper = await mountComponent();
		await pushPreviewState([animatedLowerThird], previewPlan());

		expect(itemStyle(wrapper)).not.toContain('opacity: 0');
		expect(itemStyle(wrapper)).not.toContain('transform');
	});

	it('never opens a Live Session for a preview run', async () => {
		const loads: Array<[number, number]> = [];
		mockLoadSession.value = (eventId, screenId) => {
			loads.push([eventId, screenId]);
		};

		await mountComponent();
		await pushPreviewState([animatedLowerThird], previewPlan());

		expect(loads).toEqual([]);
	});
});
