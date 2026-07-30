import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig, MediaGraphicItemConfig, ShapeGraphicItemConfig } from '~~/shared/types/graphics';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import {
	acceptedGraphicInputValues,
	createInitialBroadcastGraphicsLiveState,
	onAirBroadcastGraphicIds,
} from '~~/shared/modules/broadcast-graphics-live-session';
import { DEFAULT_GRAPHIC_TYPOGRAPHY, squareShapeGeometry } from '~~/shared/modules/graphics';
import { GRAPHICS_PREVIEW_STATE_MESSAGE } from '~/modules/graphics/previewMessages';

enableAutoUnmount(afterEach);

const mockOutputMode = ref<ScreenOutput>('overlay');
const mockOutputModeProvided = ref(true);
const mockIsPreview = ref(false);
const mockPreviewGuides = ref(false);
const mockPreviewSafeAreas = ref(false);
const mockScreen = ref<Screen | null>(null);
const mockAssetCapability = ref<string | undefined>(undefined);

mockNuxtImport('useScreenContext', () => () => ({
	screen: mockScreen,
	eventId: computed(() => 1),
	interactive: ref(false),
	overlayContainer: ref(null),
	outputMode: mockOutputModeProvided.value ? mockOutputMode : undefined,
	isPreview: mockIsPreview,
	previewGuides: mockPreviewGuides,
	previewSafeAreas: mockPreviewSafeAreas,
	assetCapability: mockAssetCapability,
}));

/**
 * Every capability-session exchange a live Screen Output makes, so a test can
 * prove media content is resolved through the capability rather than by any other
 * route.
 */
const capabilitySessionRequests: string[] = [];

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
const mockAcceptedInputs = ref<BroadcastGraphicsLiveState>(createInitialBroadcastGraphicsLiveState());
const mockLoadSession = ref<(eventId: number, screenId: number) => void>(() => {});

mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({
	// Delegates to the real reducer rather than reimplementing the authored-order
	// filter, so this test cannot pass on a filter the Screen Output does not use.
	onAirGraphicIds: (_screenId: number, graphics: readonly { id: string }[]) =>
		onAirBroadcastGraphicIds(
			{ playout: Object.fromEntries(mockOnAirGraphicIds.value.map(id => [id, { onAir: true, effectiveStartedAt: 0, cut: false }])), inputs: {} },
			graphics,
		),
	loadSession: (eventId: number, screenId: number) => mockLoadSession.value(eventId, screenId),
	// Likewise the accepted Graphic Input values a Graphic Text Template renders:
	// the real selector, so a Screen Output can never be shown a working value.
	acceptedInputValues: (_screenId: number, graphic: BroadcastGraphicConfig) =>
		acceptedGraphicInputValues(mockAcceptedInputs.value, graphic.id, graphic.inputs ?? []),
}));

const lowerThird: BroadcastGraphicConfig = {
	id: 'lower-third',
	name: 'Lower Third',
	items: [bar],
};

/** A Broadcast Graphic whose Text Graphic Item renders a Graphic Text Template. */
const templated: BroadcastGraphicConfig = {
	id: 'templated',
	name: 'Name line',
	inputs: [{
		type: 'text',
		key: 'name',
		label: 'Name',
		required: false,
		updatePolicy: 'staged',
		default: 'Unnamed',
		maxLength: 20,
	}],
	items: [{
		type: 'text',
		id: 'name-line',
		label: 'Name line',
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 600,
		height: 120,
		text: 'Live: {name}',
		typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY },
		overflowPolicy: 'ellipsis',
		minFontSize: 24,
	}],
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
		mockAssetCapability.value = undefined;
		capabilitySessionRequests.length = 0;
		vi.stubGlobal('fetch', vi.fn(async (input: string) => {
			capabilitySessionRequests.push(String(input));
			return new Response(null, { status: 204 });
		}));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
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

	describe('media Graphic Items', () => {
		const logo: MediaGraphicItemConfig = {
			type: 'media',
			id: 'logo',
			label: 'Sponsor',
			visible: true,
			anchor: 'top-left',
			x: 40,
			y: 60,
			width: 480,
			height: 270,
			asset: { assetId: 'asset-1' as never, revisionId: 'revision-7' as never },
			mediaKind: 'image',
			fit: 'cover',
			focalPosition: { horizontal: 0.25, vertical: 0.75 },
			opacity: 0.5,
			playbackRate: 1,
			loop: true,
		};

		function withMedia(overrides: Partial<MediaGraphicItemConfig> = {}): BroadcastGraphicConfig {
			return { id: 'lower-third', name: 'Lower Third', items: [{ ...logo, ...overrides }] };
		}

		it('renders an image fitted at its focal position and opacity', async () => {
			mockIsPreview.value = true;

			const wrapper = await mountComponent();
			await pushPreviewState([withMedia()]);

			const image = wrapper.get('[data-graphic-item-kind="media"] img');
			expect(image.attributes('style')).toContain('object-fit: cover');
			expect(image.attributes('style')).toContain('object-position: 25% 75%');
			expect(image.attributes('style')).toContain('opacity: 0.5');
			expect(wrapper.get('[data-graphic-item-kind="media"]').attributes('style')).toContain('left: 40px');
			// Empty alt: a broken image draws its alt text inside its own box, which in
			// the Key Output would paint the authored label into the alpha matte.
			expect(image.attributes('alt')).toBe('');
		});

		it('renders a silent video muted and autoplaying at its authored playback rate', async () => {
			mockIsPreview.value = true;

			const wrapper = await mountComponent();
			await pushPreviewState([withMedia({ mediaKind: 'silent-video', loop: false, playbackRate: 2 })]);

			const video = wrapper.get('[data-graphic-item-kind="media"] video');
			// Silent by construction rather than by an authored control: the asset is a
			// silent video and the element is muted regardless.
			expect(video.attributes('muted')).toBeDefined();
			expect(video.attributes('autoplay')).toBeDefined();
			// Playback rate is a property with no attribute, so it has to be set.
			expect((video.element as HTMLVideoElement).playbackRate).toBe(2);
			// Playback begins at zero because the element is new, not because anything
			// seeks it there.
			expect((video.element as HTMLVideoElement).currentTime).toBe(0);
		});

		it('honours the authored looping choice', async () => {
			mockIsPreview.value = true;

			const wrapper = await mountComponent();
			await pushPreviewState([withMedia({ id: 'a', mediaKind: 'silent-video', loop: true })]);
			expect(wrapper.get('[data-graphic-item-kind="media"] video').attributes('loop')).toBeDefined();

			await pushPreviewState([withMedia({ id: 'b', mediaKind: 'silent-video', loop: false })]);
			expect(wrapper.get('[data-graphic-item-kind="media"] video').attributes('loop')).toBeUndefined();
		});

		it('keeps an on-air video mounted when an unrelated part of the stack is edited', async () => {
			// Resolving content clears the URL map before refetching, which unmounts every
			// media element. A stack edit that changes no revision must not do that: it
			// would restart an on-air video from zero.
			mockAssetCapability.value = 'capability-token';
			mockScreen.value = screenWithStack([withMedia()]);
			mockOnAirGraphicIds.value = ['lower-third'];

			const wrapper = await mountComponent();
			await flushPromises();
			await nextTick();
			const before = wrapper.get('[data-graphic-item-kind="media"] img').attributes('src');
			expect(before).not.toBe('');

			// Same pinned revision, different authored geometry.
			mockScreen.value = screenWithStack([{
				id: 'lower-third',
				name: 'Lower Third',
				items: [{ ...logo, x: 99 }],
			}]);
			await flushPromises();
			await nextTick();

			// Re-resolving is what unmounts a media element: it clears the URL map before
			// refetching, so `src` empties and the `<video>` is torn down and rebuilt. No
			// second capability exchange means no such window ever opened.
			expect(capabilitySessionRequests).toHaveLength(1);
			expect(wrapper.get('[data-graphic-item-kind="media"] img').attributes('src')).toBe(before);
			expect(wrapper.get('[data-graphic-item-kind="media"]').attributes('style')).toContain('left: 99px');
		});

		it('paints media as its alpha in white in the Key Output', async () => {
			mockIsPreview.value = true;
			mockOutputMode.value = 'key';

			const wrapper = await mountComponent();
			await pushPreviewState([withMedia()]);

			// Colour removed, alpha untouched: the matte stays a true alpha matte.
			expect(wrapper.get('[data-graphic-item-kind="media"] img').attributes('style'))
				.toContain('filter: brightness(0) invert(1)');
		});

		it('renders nothing at all for an item with no asset pinned', async () => {
			mockIsPreview.value = true;

			const wrapper = await mountComponent();
			await pushPreviewState([withMedia({ asset: undefined })]);

			const item = wrapper.get('[data-graphic-item-kind="media"]');
			expect(item.find('img').exists()).toBe(false);
			expect(item.find('video').exists()).toBe(false);
		});

		it('resolves a live Screen Output’s media only through its Screen Output Asset Capability', async () => {
			// The whole point of the capability: an output URL is never a hole through
			// which the Graphics Asset Library can be browsed.
			mockAssetCapability.value = 'capability-token';
			mockScreen.value = screenWithStack([withMedia()]);
			mockOnAirGraphicIds.value = ['lower-third'];

			const wrapper = await mountComponent();
			await flushPromises();
			await nextTick();

			expect(wrapper.get('[data-graphic-item-kind="media"] img').attributes('src'))
				.toBe('/api/screen-output/screens/1/assets/asset-1/revisions/revision-7/content');
			expect(capabilitySessionRequests).toEqual(['/api/screen-output/screens/1/asset-capability-session']);
		});
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

	it('renders a Graphic Text Template from accepted values, never from a working edit', async () => {
		// A working edit is what an operator is still typing. Program shows only what
		// an acceptance put on air, so the Screen Output must never see the other one.
		mockScreen.value = screenWithStack([templated]);
		mockOnAirGraphicIds.value = ['templated'];
		mockAcceptedInputs.value = {
			playout: { templated: { onAir: true, effectiveStartedAt: 0, cut: false } },
			inputs: { templated: { working: { name: 'Half typed' }, accepted: { name: 'Ava Reed' }, acceptedRevision: 1 } },
		};

		const wrapper = await mountComponent();

		expect(wrapper.text()).toContain('Live: Ava Reed');
		expect(wrapper.text()).not.toContain('Half typed');
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
