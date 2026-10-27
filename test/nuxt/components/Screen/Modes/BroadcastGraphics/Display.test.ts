import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig, GraphicChannelConfig, GraphicGroupItemConfig, MediaGraphicItemConfig, ShapeGraphicItemConfig, SocialNetworkIconGraphicItemConfig, TextGraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, ref } from 'vue';
import {
	createInitialBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import { addGraphicGroupChild, addGraphicItem, DEFAULT_GRAPHIC_TYPOGRAPHY, squareShapeGeometry } from '~~/shared/modules/graphics';
import { liveSessionSelectors } from '~~/test/nuxt/helpers/broadcastGraphicsLiveSessionReads';
import Display from '~/components/Screen/Modes/BroadcastGraphics/Display.vue';
import { GRAPHICS_PREVIEW_READY_MESSAGE, GRAPHICS_PREVIEW_STATE_MESSAGE } from '~/modules/graphics/previewMessages';

enableAutoUnmount(afterEach);

const mockOutputMode = ref<ScreenOutput>('overlay');
const mockOutputModeProvided = ref(true);
const mockIsPreview = ref(false);
const mockPreviewGuides = ref(false);
const mockPreviewSafeAreas = ref(false);
const mockScreen = ref<Screen | null>(null);
const mockAssetCapability = ref<string | undefined>(undefined);
const mockEventCanvas = ref({ width: 1920, height: 1080 });

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
	eventCanvas: mockEventCanvas,
}));

// Every capability-session exchange a live Screen Output makes, so a test can prove media content
// is resolved through the capability rather than by any other route.
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
	surfaceStyle: {
		fill: { type: 'solid', color: '#0077a3' },
		fillOpacity: 1,
	},
};

/**
 * How each rendered Screen's snapshot is read, as the Display registered it: through
 * the Screen's capability-scoped read, never the Live Control path (#604).
 */
const mockSessionReaders = new Map<number, () => Promise<unknown>>();
const liveSessionReads = vi.hoisted(() => [] as unknown[]);

vi.mock('~/composables/repositories/useScreenOutputReadRepository', () => ({
	useScreenOutputReadRepository: () => ({
		liveSession: async (scope: unknown) => {
			liveSessionReads.push(scope);
			return { id: 55, sequence: 1 };
		},
	}),
}));

/** The authoritative playout snapshot a live Screen Output would have loaded. */
const mockOnAirGraphicIds = ref<string[]>([]);
const mockAcceptedInputs = ref<BroadcastGraphicsLiveState>(createInitialBroadcastGraphicsLiveState());
const mockLoadSession = ref<(eventId: number, screenId: number) => void>(() => {});

/** The authoritative clock a live Screen Output projects on, and the epoch it holds. */
const mockServerNow = ref(1_700_000_000_000);
const mockSessionSequence = ref(1);

// The authoritative snapshot, assembled from whichever parts a test cares about.
const mockPlayout = ref<BroadcastGraphicsLiveState['playout'] | null>(null);

function mockState(): BroadcastGraphicsLiveState {
	return {
		playout: mockPlayout.value ?? Object.fromEntries(
			mockOnAirGraphicIds.value.map(id => [
				id,
				{ onAir: true, effectiveStartedAt: 0, cut: false },
			]),
		),
		inputs: mockAcceptedInputs.value.inputs,
		sources: mockAcceptedInputs.value.sources,
		socialProfileProjections: mockAcceptedInputs.value.socialProfileProjections,
	};
}

mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({
	...liveSessionSelectors(mockState, () => mockServerNow.value),
	get sessions() {
		return new Map([
			[
				mockScreen.value?.id ?? 0,
				{ id: 55, sequence: mockSessionSequence.value },
			],
		]);
	},
	loadSession: (eventId: number, screenId: number) => mockLoadSession.value(eventId, screenId),
	readSessionAsScreenOutput: (screenId: number, read: () => Promise<unknown>) => {
		mockSessionReaders.set(screenId, read);
	},
}));

const lowerThird: BroadcastGraphicConfig = {
	id: 'lower-third',
	name: 'Lower Third',
	items: [bar],
};

const socialGraphic: BroadcastGraphicConfig = {
	id: 'social',
	name: 'Social',
	items: [
		{
			type: 'social-network-icon',
			id: 'social-icon',
			label: 'Instagram',
			visible: true,
			anchor: 'top-left',
			x: 100,
			y: 100,
			width: 120,
			height: 120,
			network: 'instagram',
			color: '#e1306c',
			opacity: 0.72,
		},
	],
};

function projectedSocialGraphic(): BroadcastGraphicConfig {
	let graphic = addGraphicItem(
		{ id: 'projected-social', name: 'Projected Social', items: [] },
		{
			kind: 'group',
			id: 'profile-group',
			canvasWidth: 1920,
			canvasHeight: 1080,
		},
	).graphic;
	graphic = addGraphicGroupChild(graphic, {
		kind: 'text',
		groupId: 'profile-group',
		id: 'profile-text',
	}).graphic;
	graphic = addGraphicGroupChild(graphic, {
		kind: 'social-network-icon',
		groupId: 'profile-group',
		id: 'profile-icon',
	}).graphic;
	const group = graphic.items[0] as GraphicGroupItemConfig;
	(group.children[0] as TextGraphicItemConfig).text = '{profile.networkLabel} — @{profile.handle}';
	(group.children[1] as SocialNetworkIconGraphicItemConfig).network = { projectionKey: 'profile' };
	graphic.sources = [
		{ key: 'talent', label: 'Talent', kind: 'talent' },
	];
	graphic.socialProfileProjections = [
		{
			key: 'profile',
			label: 'Social Profile',
			sourceKey: 'talent',
			presentationGroupId: 'profile-group',
			dwellMs: 8_000,
			transition: 'crossfade',
			transitionDurationMs: 250,
		},
	];
	return graphic;
}

/** A Broadcast Graphic whose Text Graphic Item renders a Graphic Text Template. */
const templated: BroadcastGraphicConfig = {
	id: 'templated',
	name: 'Name line',
	inputs: [
		{
			type: 'text',
			key: 'name',
			label: 'Name',
			required: false,
			updatePolicy: 'staged',
			default: 'Unnamed',
			maxLength: 20,
		},
	],
	items: [
		{
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
		},
	],
};

function screenWithStack(graphics: BroadcastGraphicConfig[] = [], channels?: GraphicChannelConfig[]): Screen {
	return {
		id: 1,
		slug: 'main',
		modeConfigs: graphics.length
			? {
					'broadcast-graphics': {
						graphics,
						...(channels
							? { channels }
							: {}),
					},
				}
			: {},
	} as Screen;
}

/** A Screen whose Broadcast Graphics Background is authored as given. */
function screenWithBackground(background: unknown, graphics: BroadcastGraphicConfig[] = []): Screen {
	return {
		id: 1,
		slug: 'main',
		modeConfigs: {
			'broadcast-graphics': { graphics, background },
		},
	} as Screen;
}

const AnimationSurfaceStub = defineComponent({
	props: {
		effect: { type: String, required: true },
		params: { type: Object, required: false, default: undefined },
		width: { type: Number, required: true },
		height: { type: Number, required: true },
	},
	template: '<div data-testid="animation-surface" />',
});

async function mountComponent() {
	return mount(Display, {
		global: {
			stubs: { ScreenAnimationEffectSurface: AnimationSurfaceStub },
		},
	});
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
	items: [
		{
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
		},
	],
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
		mockEventCanvas.value = { width: 1920, height: 1080 };
		mockOutputModeProvided.value = true;
		mockIsPreview.value = false;
		mockPreviewGuides.value = false;
		mockPreviewSafeAreas.value = false;
		mockScreen.value = screenWithStack();
		mockOnAirGraphicIds.value = [];
		mockPlayout.value = null;
		mockAcceptedInputs.value = createInitialBroadcastGraphicsLiveState();
		mockServerNow.value = 1_700_000_000_000;
		mockSessionSequence.value = 1;
		mockLoadSession.value = () => {};
		mockSessionReaders.clear();
		mockAssetCapability.value = undefined;
		capabilitySessionRequests.length = 0;
		vi.stubGlobal('fetch', vi.fn(async (input: string) => {
			capabilitySessionRequests.push(String(input));
			return new Response(JSON.stringify({}), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
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

	it('renders the same social icon through the embedded preview and live output paths', async () => {
		mockIsPreview.value = true;
		const preview = await mountComponent();
		await pushPreviewState([socialGraphic]);
		await flushPromises();
		const previewIcon = preview.get('[data-social-network-icon]');
		const previewSignature = {
			classes: previewIcon.classes(),
			style: previewIcon.attributes('style'),
		};
		preview.unmount();

		mockIsPreview.value = false;
		mockScreen.value = screenWithStack([socialGraphic]);
		mockOnAirGraphicIds.value = ['social'];
		const live = await mountComponent();
		await flushPromises();
		const liveIcon = live.get('[data-social-network-icon]');

		expect(liveIcon.classes()).toContain('i-simple-icons:instagram');
		expect({
			classes: liveIcon.classes(),
			style: liveIcon.attributes('style'),
		}).toEqual(previewSignature);
		expect(liveIcon.attributes('style')).toContain('color: #e1306c');
		expect(liveIcon.attributes('style')).toContain('opacity: 0.72');
	});

	it('renders only the authoritative current Social Profile tuple on a live Screen Output', async () => {
		const graphic = projectedSocialGraphic();
		mockScreen.value = screenWithStack([graphic]);
		mockOnAirGraphicIds.value = [graphic.id];
		mockAcceptedInputs.value = {
			...createInitialBroadcastGraphicsLiveState(),
			socialProfileProjections: {
				[graphic.id]: {
					profile: {
						acceptedProfiles: [
							{
								network: 'twitch',
								networkLabel: 'Twitch',
								handle: 'AvaLive',
								profileUrl: 'https://www.twitch.tv/AvaLive',
							},
							{
								network: 'x',
								networkLabel: 'X',
								handle: 'AvaCasts',
								profileUrl: 'https://x.com/AvaCasts',
							},
						],
						currentNetwork: 'x',
					},
				},
			},
		};

		const wrapper = await mountComponent();
		await nextTick();

		expect(wrapper.get('[data-graphic-item-kind="text"] p').text()).toBe('X — @AvaCasts');
		expect(wrapper.get('[data-social-network-icon]').classes()).toContain('i-simple-icons:x');

		mockAcceptedInputs.value = createInitialBroadcastGraphicsLiveState();
		await nextTick();
		expect(wrapper.find('[data-graphic-item-kind="group"]').exists()).toBe(false);
	});

	it('uses the graphic update animation to crossfade an explicitly accepted Social Profile change', async () => {
		const updateAt = 1_700_000_000_000;
		const graphic = projectedSocialGraphic();
		graphic.items[0]!.animation = {
			update: {
				duration: 1000,
				easing: 'linear',
				delay: 0,
				fade: { opacity: 0 },
			},
		};
		mockScreen.value = screenWithStack([graphic]);
		mockOnAirGraphicIds.value = [graphic.id];
		mockServerNow.value = updateAt;
		mockPlayout.value = {
			[graphic.id]: {
				onAir: true,
				effectiveStartedAt: updateAt - 10_000,
				cut: false,
				updateStartedAt: updateAt - 500,
			},
		};
		mockAcceptedInputs.value = {
			...createInitialBroadcastGraphicsLiveState(),
			inputs: {
				[graphic.id]: {
					working: {},
					accepted: {},
					acceptedRevision: 2,
					updateFrom: {},
				},
			},
			socialProfileProjections: {
				[graphic.id]: {
					profile: {
						acceptedProfiles: [
							{
								network: 'youtube',
								networkLabel: 'YouTube',
								handle: 'After',
								profileUrl: 'https://www.youtube.com/@After',
							},
						],
						currentNetwork: 'youtube',
						updateFrom: [
							{
								values: {
									network: 'twitch',
									networkLabel: 'Twitch',
									handle: 'Before',
									profileUrl: 'https://www.twitch.tv/Before',
								},
								opacity: 1,
								offsetX: 0,
								offsetY: 0,
							},
						],
					},
				},
			},
		};

		const wrapper = await mountComponent();
		await nextTick();

		expect(wrapper.findAll('[data-graphic-item-kind="text"] p').map(node => node.text()))
			.toEqual(['Twitch — @Before', 'YouTube — @After']);
		expect(wrapper.findAll('[data-social-profile-presentation="profile-group"]')).toHaveLength(2);
		expect(wrapper.find('[data-graphic-item-cross-transition="profile-group"]').exists()).toBe(true);
	});

	it('renders synchronized outgoing and incoming Presentation Groups at the authoritative transition instant', async () => {
		const graphic = projectedSocialGraphic();
		graphic.socialProfileProjections![0]!.transition = 'slide-left';
		mockScreen.value = screenWithStack([graphic]);
		mockOnAirGraphicIds.value = [graphic.id];
		mockServerNow.value = 1_008_125;
		mockAcceptedInputs.value = {
			...createInitialBroadcastGraphicsLiveState(),
			socialProfileProjections: {
				[graphic.id]: {
					profile: {
						acceptedProfiles: [
							{
								network: 'twitch',
								networkLabel: 'Twitch',
								handle: 'AvaLive',
								profileUrl: 'https://www.twitch.tv/AvaLive',
							},
							{
								network: 'x',
								networkLabel: 'X',
								handle: 'AvaCasts',
								profileUrl: 'https://x.com/AvaCasts',
							},
						],
						currentNetwork: 'twitch',
						automatic: true,
						rotationAnchor: { network: 'twitch', anchoredAt: 1_000_000 },
					},
				},
			},
		};

		const wrapper = await mountComponent();
		await nextTick();

		const presentation = wrapper.get('[data-social-profile-presentation="profile-group"]');
		const layers = presentation.findAll(':scope > [data-graphic-item-kind="group"]');
		expect(presentation.attributes('style')).toContain('overflow: hidden');
		expect(layers.map(layer => layer.attributes('style'))).toEqual([
			expect.stringContaining('translate(-50%, 0%)'),
			expect.stringContaining('translate(50%, 0%)'),
		]);
		expect(layers.map(layer => layer.get('p').text())).toEqual(['Twitch — @AvaLive', 'X — @AvaCasts']);
		expect(layers.map(layer => layer.get('[data-social-network-icon]').classes())).toEqual([
			expect.arrayContaining(['i-simple-icons:twitch']),
			expect.arrayContaining(['i-simple-icons:x']),
		]);
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

		mockAssetCapability.value = 'capability-token';

		await mountComponent();

		expect(loads).toEqual([
			[1, 1],
		]);
		liveSessionReads.length = 0;
		await mockSessionReaders.get(1)?.();
		expect(liveSessionReads).toEqual([
			{ eventId: 1, screenId: 1, assetCapability: 'capability-token' },
		]);
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

	// The editor's only other moment to push is the iframe's `load` event, which this client-
	// rendered application fires before the frame's own app has mounted as often as after it.
	it('tells the editor it is listening, as soon as it is', async () => {
		mockIsPreview.value = true;
		const announced: unknown[] = [];
		const parent = {
			postMessage: (message: unknown) => announced.push(message),
		};
		const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
		Object.defineProperty(window, 'parent', { configurable: true, value: parent });

		try {
			await mountComponent();
		}
		finally {
			if (originalParent)
				Object.defineProperty(window, 'parent', originalParent);
		}

		expect(announced).toEqual([
			{ type: GRAPHICS_PREVIEW_READY_MESSAGE },
		]);
	});

	it('announces nothing when it is its own parent, having nobody to tell', async () => {
		// A preview URL opened in its own tab rather than embedded. `window.parent`
		// is then this window, and the announcement would be to itself.
		mockIsPreview.value = true;
		const announced: unknown[] = [];
		const originalPostMessage = window.postMessage;
		window.postMessage = ((message: unknown) => announced.push(message)) as typeof window.postMessage;

		try {
			await mountComponent();
		}
		finally {
			window.postMessage = originalPostMessage;
		}

		expect(announced).toEqual([]);
	});

	it('announces nothing from a live Screen Output, which has no editor to answer', async () => {
		const announced: unknown[] = [];
		const parent = {
			postMessage: (message: unknown) => announced.push(message),
		};
		const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
		Object.defineProperty(window, 'parent', { configurable: true, value: parent });

		try {
			mockScreen.value = screenWithStack([lowerThird]);
			await mountComponent();
		}
		finally {
			if (originalParent)
				Object.defineProperty(window, 'parent', originalParent);
		}

		expect(announced).toEqual([]);
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
			return {
				id: 'lower-third',
				name: 'Lower Third',
				items: [
					{
						...logo,
						...overrides,
					},
				],
			};
		}

		it('renders an image fitted at its focal position and opacity', async () => {
			mockIsPreview.value = true;

			const wrapper = await mountComponent();
			await pushPreviewState([
				withMedia(),
			]);

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
			await pushPreviewState([
				withMedia({ mediaKind: 'silent-video', loop: false, playbackRate: 2 }),
			]);

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
			await pushPreviewState([
				withMedia({ id: 'a', mediaKind: 'silent-video', loop: true }),
			]);
			expect(wrapper.get('[data-graphic-item-kind="media"] video').attributes('loop')).toBeDefined();

			await pushPreviewState([
				withMedia({ id: 'b', mediaKind: 'silent-video', loop: false }),
			]);
			expect(wrapper.get('[data-graphic-item-kind="media"] video').attributes('loop')).toBeUndefined();
		});

		it('keeps an on-air video mounted when an unrelated part of the stack is edited', async () => {
			// Resolving content clears the URL map before refetching, which unmounts every
			// media element. A stack edit that changes no revision must not do that: it
			// would restart an on-air video from zero.
			mockAssetCapability.value = 'capability-token';
			mockScreen.value = screenWithStack([
				withMedia(),
			]);
			mockOnAirGraphicIds.value = ['lower-third'];

			const wrapper = await mountComponent();
			await flushPromises();
			await nextTick();
			const before = wrapper.get('[data-graphic-item-kind="media"] img').attributes('src');
			expect(before).not.toBe('');

			// Same pinned revision, different authored geometry.
			mockScreen.value = screenWithStack([
				{
					id: 'lower-third',
					name: 'Lower Third',
					items: [
						{ ...logo, x: 99 },
					],
				},
			]);
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
			await pushPreviewState([
				withMedia(),
			]);

			// Colour removed, alpha untouched: the matte stays a true alpha matte.
			expect(wrapper.get('[data-graphic-item-kind="media"] img').attributes('style'))
				.toContain('filter: brightness(0) invert(1)');
		});

		it('renders nothing at all for an item with no asset pinned', async () => {
			mockIsPreview.value = true;

			const wrapper = await mountComponent();
			await pushPreviewState([
				withMedia({ asset: undefined }),
			]);

			const item = wrapper.get('[data-graphic-item-kind="media"]');
			expect(item.find('img').exists()).toBe(false);
			expect(item.find('video').exists()).toBe(false);
		});

		it('resolves a live Screen Output’s media only through its Screen Output Asset Capability', async () => {
			// The whole point of the capability: an output URL is never a hole through
			// which the Graphics Asset Library can be browsed.
			mockAssetCapability.value = 'capability-token';
			mockScreen.value = screenWithStack([
				withMedia(),
			]);
			mockOnAirGraphicIds.value = ['lower-third'];

			const wrapper = await mountComponent();
			await flushPromises();
			await nextTick();

			expect(wrapper.get('[data-graphic-item-kind="media"] img').attributes('src'))
				.toBe('/api/screen-output/screens/1/assets/asset-1/revisions/revision-7/content');
			expect(capabilitySessionRequests).toEqual(['/api/screen-output/screens/1/asset-capability-session']);
		});

		// A bound item's picture is the Screen's resolved logo, its override here (#831).
		it('resolves a media item bound to the logo from the Screen\'s own override, through its capability', async () => {
			mockAssetCapability.value = 'capability-token';
			mockScreen.value = {
				...screenWithStack([
					withMedia({
						themeBindings: { media: 'logo' },
					}),
				]),
				themeOverrides: {
					logo: { kind: 'image', assetId: 'logo-asset', revisionId: 'logo-revision' },
				},
			} as never;
			mockOnAirGraphicIds.value = ['lower-third'];

			const wrapper = await mountComponent();
			await flushPromises();
			await nextTick();

			expect(wrapper.get('[data-graphic-item-kind="media"] img').attributes('src'))
				.toBe('/api/screen-output/screens/1/assets/logo-asset/revisions/logo-revision/content');
		});

		/**
		 * Chromium is the only supported engine for transparent video (ADR-0020), so a
		 * live output renders every silent video it publishes as a video.
		 */
		it('plays a silent video on a live output, whatever the browser', async () => {
			mockAssetCapability.value = 'capability-token';
			mockScreen.value = screenWithStack([
				withMedia({ mediaKind: 'silent-video' }),
			]);
			mockOnAirGraphicIds.value = ['lower-third'];

			const wrapper = await mountComponent();
			await flushPromises();
			await nextTick();

			expect(wrapper.get('[data-graphic-item-kind="media"] video').attributes('src'))
				.toBe('/api/screen-output/screens/1/assets/asset-1/revisions/revision-7/content');
		});
	});

	// A Broadcast Graphics Screen Output paints a Graphics Asset Library font (#141).
	describe('library fonts', () => {
		const fontAssetId = 'font-asset' as GraphicAssetId;

		/**
		 * A `FontFace` stub that records every family registered, with a gate a test can
		 * close so it can read the canvas while a load is in flight.
		 */
		function stubRecordingFontFace() {
			const registered: string[] = [];
			let hold = Promise.resolve();
			vi.stubGlobal('FontFace', class {
				constructor(public family: string, public source: string) {
					registered.push(family);
				}

				async load() {
					await hold;
					return this;
				}
			});
			return {
				registered,
				/** Holds every load started from now until the returned release is called. */
				gate() {
					let release!: () => void;
					hold = new Promise<void>((resolve) => {
						release = resolve;
					});
					return () => release();
				},
			};
		}

		function withLibraryFont(
			{ revisionId = 'font-revision-2', text = 'Player One' }: { revisionId?: string; text?: string } = {},
		): BroadcastGraphicConfig {
			return {
				id: 'lower-third',
				name: 'Lower Third',
				items: [
					{
						type: 'text',
						id: 'name-line',
						label: 'Name line',
						visible: true,
						anchor: 'top-left',
						x: 0,
						y: 0,
						width: 600,
						height: 120,
						text,
						typography: {
							...DEFAULT_GRAPHIC_TYPOGRAPHY,
							font: {
								kind: 'asset',
								reference: { assetId: fontAssetId, revisionId: revisionId as GraphicAssetRevisionId },
							},
						},
						overflowPolicy: 'ellipsis',
						minFontSize: 24,
					},
				],
			};
		}

		/**
		 * A second Broadcast Graphic pinning an image, so joining it to the stack moves
		 * the Screen's asset reference set without naming a font.
		 */
		function withImage(): BroadcastGraphicConfig {
			return {
				id: 'sponsor',
				name: 'Sponsor',
				items: [
					{
						type: 'media',
						id: 'logo',
						label: 'Sponsor',
						visible: true,
						anchor: 'top-left',
						x: 40,
						y: 60,
						width: 480,
						height: 270,
						asset: {
							assetId: 'image-asset' as GraphicAssetId,
							revisionId: 'image-revision-1' as GraphicAssetRevisionId,
						},
						mediaKind: 'image',
						fit: 'cover',
						focalPosition: { horizontal: 0.5, vertical: 0.5 },
						opacity: 1,
						playbackRate: 1,
						loop: false,
					},
				],
			};
		}

		beforeEach(() => {
			Object.defineProperty(document, 'fonts', {
				configurable: true,
				value: {
					add: vi.fn(),
					delete: vi.fn(),
					load: vi.fn().mockResolvedValue([]),
					check: vi.fn().mockReturnValue(true),
					ready: Promise.resolve(),
				},
			});
		});

		it('paints text in the FontFace family the pinned revision resolves to', async () => {
			mockIsPreview.value = true;
			vi.stubGlobal('FontFace', class {
				constructor(public family: string, public source: string) {}
				async load() { return this; }
			});

			const wrapper = await mountComponent();
			await pushPreviewState([
				withLibraryFont(),
			]);

			// The family is derived from the exact revision, so two revisions of one font
			// are two families and a pinned reference always paints the bytes it pinned.
			// It is authored quoted and serialises unquoted, because it is a valid CSS
			// ident either way.
			expect(wrapper.get('[data-graphic-item-kind="text"] p').attributes('style'))
				.toContain('font-family: stream-keepr-graphic-asset-font-asset-font-revision-2;');
		});

		it('hides the canvas until every exact font revision is ready', async () => {
			// A FontFace that has not loaded paints in a fallback family, so an output
			// shown while loading flashes the wrong typeface on air and reflows when the
			// real one arrives. Blank is the lesser failure, and it is legible.
			mockAssetCapability.value = 'capability-token';
			mockScreen.value = screenWithStack([
				withLibraryFont(),
			]);
			let finishLoad!: () => void;
			const loaded = new Promise<void>((resolve) => {
				finishLoad = resolve;
			});
			vi.stubGlobal('FontFace', class {
				constructor(public family: string, public source: string) {}
				async load() {
					await loaded;
					return this;
				}
			});

			const wrapper = await mountComponent();
			await flushPromises();
			await nextTick();

			const canvas = wrapper.get('.graphics-compositor-canvas');
			expect(canvas.attributes('data-font-ready')).toBe('false');
			expect((canvas.element as HTMLElement).style.visibility).toBe('hidden');

			finishLoad();
			await vi.waitFor(() => {
				expect(wrapper.get('.graphics-compositor-canvas').attributes('data-font-ready')).toBe('true');
			});
			expect((wrapper.get('.graphics-compositor-canvas').element as HTMLElement).style.visibility).toBe('');
			expect(document.fonts.add as ReturnType<typeof vi.fn>).toHaveBeenCalled();
		});

		it('loads the revision through the Screen Output Asset Capability, not the library', async () => {
			// A font is content like any other, so a live output reaches it by exactly the
			// route its images take and by no other.
			mockAssetCapability.value = 'capability-token';
			mockScreen.value = screenWithStack([
				withLibraryFont(),
			]);
			const sources: string[] = [];
			vi.stubGlobal('FontFace', class {
				constructor(public family: string, public source: string) {
					sources.push(source);
				}

				async load() { return this; }
			});

			await mountComponent();
			await flushPromises();
			await nextTick();

			await vi.waitFor(() => {
				expect(sources).toEqual([
					'url("/api/screen-output/screens/1/assets/font-asset/revisions/font-revision-2/content")',
				]);
			});
			expect(capabilitySessionRequests).toEqual(['/api/screen-output/screens/1/asset-capability-session']);
		});

		it('reports a font that cannot load rather than leaving the canvas silently blank', async () => {
			// Hiding is the right response to a font that has not loaded yet, but a
			// failure hidden the same way a load-in-progress is hidden is a permanently
			// blank output with nothing to read off it. `data-font-error` is what tells
			// the two apart.
			mockAssetCapability.value = 'capability-token';
			mockScreen.value = screenWithStack([
				withLibraryFont(),
			]);
			vi.stubGlobal('FontFace', class {
				constructor(public family: string, public source: string) {}
				async load(): Promise<never> {
					throw new Error('font revision content is unavailable');
				}
			});

			const wrapper = await mountComponent();
			await flushPromises();
			await nextTick();

			await vi.waitFor(() => {
				expect(wrapper.get('.graphics-compositor-canvas').attributes('data-font-error')).toBe('true');
			});
			const canvas = wrapper.get('.graphics-compositor-canvas');
			expect(canvas.attributes('data-font-ready')).toBe('false');
			expect((canvas.element as HTMLElement).style.visibility).toBe('hidden');
		});

		// The Take the issue names, and the one stack change that does not leave the Screen's asset
		// reference set alone: a second Broadcast Graphic joins carrying an image.
		it('keeps a settled canvas visible when a Take brings on an asset of another kind', async () => {
			mockAssetCapability.value = 'capability-token';
			mockScreen.value = screenWithStack([
				withLibraryFont(),
			]);
			mockOnAirGraphicIds.value = ['lower-third'];
			const { registered } = stubRecordingFontFace();

			const wrapper = await mountComponent();
			await flushPromises();
			await nextTick();
			await vi.waitFor(() => {
				expect(wrapper.get('.graphics-compositor-canvas').attributes('data-font-ready')).toBe('true');
			});
			const settled = [...registered];
			expect(settled).toEqual(['stream-keepr-graphic-asset-font-asset-font-revision-2']);
			expect(capabilitySessionRequests).toHaveLength(1);

			mockScreen.value = screenWithStack([
				withLibraryFont(),
				withImage(),
			]);
			await nextTick();

			const canvas = wrapper.get('.graphics-compositor-canvas');
			// Read at the moment the Take renders, which is when the blank would be on air.
			expect(canvas.attributes('data-font-ready')).toBe('true');
			expect((canvas.element as HTMLElement).style.visibility).toBe('');

			await flushPromises();
			await nextTick();
			await flushPromises();

			// A second capability exchange is the proof the window really opened: the URL
			// map was cleared and refetched around this assertion.
			expect(capabilitySessionRequests).toHaveLength(2);
			expect(wrapper.get('.graphics-compositor-canvas').attributes('data-font-ready')).toBe('true');
			expect((wrapper.get('.graphics-compositor-canvas').element as HTMLElement).style.visibility).toBe('');
			expect(registered).toEqual(settled);
		});
	});

	it('composes a Graphic Group and its children in one stacking context', async () => {
		mockIsPreview.value = true;
		const grouped: BroadcastGraphicConfig = {
			id: 'lower-third',
			name: 'Lower Third',
			items: [
				{
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
					children: [
						{
							...bar,
							id: 'child',
							x: 0,
							y: 0,
							sizing: { mode: 'fill', size: 0, weight: 1 },
						},
					],
				},
			],
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
			playout: {
				templated: { onAir: true, effectiveStartedAt: 0, cut: false },
			},
			inputs: {
				templated: {
					working: { name: 'Half typed' },
					accepted: { name: 'Ava Reed' },
					acceptedRevision: 1,
				},
			},
		};

		const wrapper = await mountComponent();

		expect(wrapper.text()).toContain('Live: Ava Reed');
		expect(wrapper.text()).not.toContain('Half typed');
	});

	describe('a Broadcast Graphic in two lifecycle phases at once', () => {
		const CROSS_FADE = {
			duration: 400,
			easing: 'linear' as const,
			delay: 0,
			fade: { opacity: 0 },
		};

		/** Exiting for 200ms of 400ms, with an update that began at the same instant. */
		function exitingMidUpdate() {
			mockPlayout.value = {
				templated: {
					onAir: false,
					effectiveStartedAt: mockServerNow.value - 200,
					cut: false,
					updateStartedAt: mockServerNow.value - 200,
				},
			};
			mockAcceptedInputs.value = {
				playout: {},
				inputs: {
					templated: {
						working: {},
						accepted: { name: 'Ava Reed' },
						acceptedRevision: 2,
						updateFrom: { name: 'Bo Lin' },
					},
				},
			};
		}

		it('draws the crossing pair beneath the exit rather than cutting to the new rendering', async () => {
			mockScreen.value = screenWithStack([
				{
					...templated,
					items: templated.items.map(item => ({
						...item,
						animation: { update: CROSS_FADE },
					})),
					animation: { exit: CROSS_FADE },
				},
			]);
			exitingMidUpdate();

			const wrapper = await mountComponent();

			// Both renderings are still on screen, crossing, while the graphic leaves.
			const pair = wrapper.get('[data-graphic-item-cross-transition]');
			expect(pair.text()).toContain('Ava Reed');
			expect(pair.text()).toContain('Bo Lin');
			// And the exit is running over them: half way through a 400ms fade.
			expect(wrapper.get('[data-broadcast-graphic="templated"]').attributes('style'))
				.toContain('opacity: 0.5');
		});
	});
});

describe('graphicAnimationPreview in a Screen Output frame', () => {
	beforeEach(() => {
		mockOutputMode.value = 'overlay';
		mockEventCanvas.value = { width: 1920, height: 1080 };
		mockOutputModeProvided.value = true;
		mockIsPreview.value = true;
		mockPreviewGuides.value = false;
		mockPreviewSafeAreas.value = false;
		mockScreen.value = screenWithStack();
		mockOnAirGraphicIds.value = [];
		mockPlayout.value = null;
		mockAcceptedInputs.value = createInitialBroadcastGraphicsLiveState();
		mockServerNow.value = 1_700_000_000_000;
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
			items: [
				{
					...bar,
					animation: {
						exit: {
							duration: 4000,
							easing: 'linear',
							delay: 0,
							reveal: { edge: 'right' },
						},
					},
				},
			],
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

describe('live playout animation in a Screen Output', () => {
	/** A four-second fade-and-slide entrance and a two-second wipe out. */
	const ANIMATED: BroadcastGraphicConfig = {
		...lowerThird,
		items: [
			{
				...bar,
				animation: {
					enter: {
						duration: 4000,
						easing: 'linear',
						delay: 0,
						fade: { opacity: 0 },
						slide: { direction: 'south', distanceMode: 'fixed', distance: 120 },
					},
					exit: {
						duration: 2000,
						easing: 'linear',
						delay: 0,
						fade: { opacity: 0 },
					},
				},
			},
		],
	};

	const T0 = 1_700_000_000_000;

	beforeEach(() => {
		mockOutputMode.value = 'overlay';
		mockEventCanvas.value = { width: 1920, height: 1080 };
		mockOutputModeProvided.value = true;
		mockIsPreview.value = false;
		mockPreviewGuides.value = false;
		mockPreviewSafeAreas.value = false;
		mockScreen.value = screenWithStack([ANIMATED]);
		mockOnAirGraphicIds.value = [];
		mockAcceptedInputs.value = createInitialBroadcastGraphicsLiveState();
		mockPlayout.value = null;
		mockServerNow.value = T0;
		mockSessionSequence.value = 1;
		mockLoadSession.value = () => {};
		mockAssetCapability.value = undefined;
	});

	it('keeps an exiting Broadcast Graphic on program until its exit completes', async () => {
		mockPlayout.value = {
			'lower-third': { onAir: false, effectiveStartedAt: T0 - 1000, cut: false },
		};

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-broadcast-graphic="lower-third"]').exists()).toBe(true);
		expect(itemStyle(wrapper)).toContain('opacity: 0.5');
	});

	it('removes an exiting Broadcast Graphic from program once its exit has completed', async () => {
		mockPlayout.value = {
			'lower-third': { onAir: false, effectiveStartedAt: T0 - 3000, cut: false },
		};

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-broadcast-graphic="lower-third"]').exists()).toBe(false);
	});

	describe('a Graphic Channel the Screen Output is composed against', () => {
		const CHANNEL: GraphicChannelConfig = { id: 'thirds', name: 'Lower thirds', handoff: 'out-then-in' };
		const outgoing: BroadcastGraphicConfig = { ...ANIMATED, channelId: 'thirds' };
		const incoming: BroadcastGraphicConfig = {
			...ANIMATED,
			id: 'bug',
			name: 'Bug',
			channelId: 'thirds',
		};

		/**
		 * An Out then in handoff one second in: the outgoing exit has another second to
		 * run, and the incoming enter is scheduled at its completion.
		 */
		function midHandoff() {
			mockScreen.value = screenWithStack([outgoing, incoming], [CHANNEL]);
			mockPlayout.value = {
				'lower-third': { onAir: false, effectiveStartedAt: T0 - 1000, cut: false },
				'bug': { onAir: true, effectiveStartedAt: T0 + 1000, cut: false },
			};
		}

		it('keeps a waiting Broadcast Graphic out of the composed frame', async () => {
			midHandoff();

			const wrapper = await mountComponent();

			// Waiting is absent from overlay, fill, and key alike, and it is reachable only
			// through the Screen's Graphic Channels — so this is also what proves the output
			// actually passes them. Composed without them, the incoming graphic's deferred
			// start reads as an entrance and it appears on program early.
			expect(wrapper.find('[data-broadcast-graphic="lower-third"]').exists()).toBe(true);
			expect(wrapper.find('[data-broadcast-graphic="bug"]').exists()).toBe(false);
		});

		it('composes it the instant the outgoing exit completes', async () => {
			midHandoff();
			mockServerNow.value = T0 + 1000;

			const wrapper = await mountComponent();

			expect(wrapper.find('[data-broadcast-graphic="lower-third"]').exists()).toBe(false);
			expect(wrapper.find('[data-broadcast-graphic="bug"]').exists()).toBe(true);
		});
	});

	it('draws both renderings while an update cross-transitions, and only then', async () => {
		const updating: BroadcastGraphicConfig = {
			...templated,
			items: [
				{
					...templated.items[0]!,
					animation: {
						update: {
							duration: 1000,
							easing: 'linear',
							delay: 0,
							fade: { opacity: 0 },
						},
					},
				},
			],
		};
		mockScreen.value = screenWithStack([updating]);
		mockPlayout.value = {
			templated: {
				onAir: true,
				effectiveStartedAt: T0 - 10_000,
				cut: false,
				updateStartedAt: T0 - 500,
			},
		};
		mockAcceptedInputs.value = {
			playout: {},
			inputs: {
				templated: {
					working: { name: 'After' },
					accepted: { name: 'After' },
					acceptedRevision: 2,
					updateFrom: { name: 'Before' },
				},
			},
		};

		const wrapper = await mountComponent();
		const texts = wrapper.findAll('[data-graphic-item-kind="text"] p').map(node => node.text());

		// The old rendering is drawn inside the item's own box, immediately behind the new
		// one, so Graphic Layer Order still composes around the pair.
		expect(texts).toEqual(['Live: Before', 'Live: After']);
		expect(wrapper.find('[data-graphic-item-cross-transition="name-line"]').exists()).toBe(true);
		expect(wrapper.find('[data-broadcast-graphic-outgoing="templated"]').exists()).toBe(false);
	});

	it('draws one rendering once the update has completed', async () => {
		const updating: BroadcastGraphicConfig = {
			...templated,
			items: [
				{
					...templated.items[0]!,
					animation: {
						update: {
							duration: 1000,
							easing: 'linear',
							delay: 0,
							fade: { opacity: 0 },
						},
					},
				},
			],
		};
		mockScreen.value = screenWithStack([updating]);
		mockPlayout.value = {
			templated: {
				onAir: true,
				effectiveStartedAt: T0 - 10_000,
				cut: false,
				updateStartedAt: T0 - 5000,
			},
		};
		mockAcceptedInputs.value = {
			playout: {},
			inputs: {
				templated: {
					working: { name: 'After' },
					accepted: { name: 'After' },
					acceptedRevision: 2,
					updateFrom: { name: 'Before' },
				},
			},
		};

		const wrapper = await mountComponent();

		expect(wrapper.findAll('[data-graphic-item-kind="text"] p').map(node => node.text())).toEqual(['Live: After']);
		expect(wrapper.find('[data-graphic-item-cross-transition="name-line"]').exists()).toBe(false);
	});

	it('shows the rendering it entered with while an acceptance coalesces behind the entrance', async () => {
		const updating: BroadcastGraphicConfig = {
			...templated,
			items: [
				{
					...templated.items[0]!,
					animation: {
						enter: {
							duration: 4000,
							easing: 'linear',
							delay: 0,
							fade: { opacity: 0 },
						},
						update: {
							duration: 1000,
							easing: 'linear',
							delay: 0,
							fade: { opacity: 0 },
						},
					},
				},
			],
		};
		mockScreen.value = screenWithStack([updating]);
		// Taken one second ago with "Before"; an acceptance of "After" is scheduled for
		// the instant the entrance completes, three seconds from now.
		mockPlayout.value = {
			templated: {
				onAir: true,
				effectiveStartedAt: T0 - 1000,
				cut: false,
				updateStartedAt: T0 + 3000,
			},
		};
		mockAcceptedInputs.value = {
			playout: {},
			inputs: {
				templated: {
					working: { name: 'After' },
					accepted: { name: 'After' },
					acceptedRevision: 2,
					updateFrom: { name: 'Before' },
				},
			},
		};

		const wrapper = await mountComponent();

		expect(wrapper.findAll('[data-graphic-item-kind="text"] p').map(node => node.text())).toEqual(['Live: Before']);
		expect(wrapper.find('[data-graphic-item-cross-transition="name-line"]').exists()).toBe(false);
	});
	describe('broadcast graphics background', () => {
		const fogBackground = {
			enabled: true,
			effect: 'fog',
			opacity: 0.4,
			params: { speed: 2 },
		};

		it('mounts the authored background on the shared surface, with its sparse params filled from the schema', async () => {
			mockScreen.value = screenWithBackground(fogBackground);

			const wrapper = await mountComponent();
			const surface = wrapper.getComponent(AnimationSurfaceStub);

			expect(surface.props('effect')).toBe('fog');
			expect(surface.props('params')).toMatchObject({ speed: 2, softness: 0.55 });
		});

		// ADR-0051: Broadcast Graphics compose in the Event Canvas.
		it('paints the background across the Event Canvas', async () => {
			mockEventCanvas.value = { width: 1280, height: 720 };
			mockScreen.value = screenWithBackground(fogBackground);

			const surface = (await mountComponent()).getComponent(AnimationSurfaceStub);

			expect([
				surface.props('width'),
				surface.props('height'),
			]).toEqual([1280, 720]);
		});

		it('composes the background behind every Broadcast Graphic, at the authored opacity', async () => {
			mockScreen.value = screenWithBackground(fogBackground, [lowerThird]);
			mockOnAirGraphicIds.value = ['lower-third'];

			const wrapper = await mountComponent();
			const backdrop = wrapper.get('[data-testid="broadcast-graphics-background"]');
			const graphic = wrapper.get('[data-broadcast-graphic="lower-third"]').element;

			expect(backdrop.attributes('style')).toContain('opacity: 0.4');
			expect(backdrop.element.compareDocumentPosition(graphic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		});

		it('renders the background in the Fill Output, which is the output it colours', async () => {
			mockScreen.value = screenWithBackground(fogBackground);
			mockOutputMode.value = 'fill';

			const wrapper = await mountComponent();

			expect(wrapper.find('[data-testid="animation-surface"]').exists()).toBe(true);
		});

		it('renders no background in the Key Output, so the alpha matte keeps its identity', async () => {
			// The Feature Match Overlay Frame's rule, verbatim: every painted element in a
			// Key Output is pure white at its own alpha over black, and a shader field is
			// neither.
			mockScreen.value = screenWithBackground(fogBackground);
			mockOutputMode.value = 'key';

			const wrapper = await mountComponent();

			expect(wrapper.find('[data-testid="animation-surface"]').exists()).toBe(false);
		});

		it('renders no background while it is switched off', async () => {
			mockScreen.value = screenWithBackground({ ...fogBackground, enabled: false });

			const wrapper = await mountComponent();

			expect(wrapper.find('[data-testid="animation-surface"]').exists()).toBe(false);
		});

		it('renders no background for an Animation Effect this build does not ship', async () => {
			mockScreen.value = screenWithBackground({ enabled: true, effect: 'vanta-birds', opacity: 0.4 });

			const wrapper = await mountComponent();

			expect(wrapper.find('[data-testid="animation-surface"]').exists()).toBe(false);
		});

		it('renders no background under an authoring preview, which keeps its own backdrop', async () => {
			mockScreen.value = screenWithBackground(fogBackground);
			mockIsPreview.value = true;

			const wrapper = await mountComponent();
			await pushPreviewState();

			expect(wrapper.find('[data-broadcast-graphic="lower-third"]').exists()).toBe(true);
			expect(wrapper.find('[data-testid="animation-surface"]').exists()).toBe(false);
		});

		it('renders no backdrop element at all on a Screen with no background', async () => {
			mockScreen.value = screenWithStack([lowerThird]);
			mockOnAirGraphicIds.value = ['lower-third'];

			const wrapper = await mountComponent();

			expect(wrapper.find('.graphics-compositor-canvas__backdrop').exists()).toBe(false);
		});
	});
});
